package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type viewerChannel struct {
	runtimeID  string
	generation int64
	rfb        bool
	cancel     context.CancelFunc
	body       io.Closer
}

func isWebSocket(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// Lifecycle serialization closes the gap between starting/attaching and
// registering ownership. Pending upgrades are owned too, before any host I/O.
func (m *manager) openViewerChannel(id string, rfb bool, r *http.Request) (*viewerChannel, *http.Request, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil {
		return nil, r, errors.New("instance not found")
	}
	if item.State != "server-ready" && item.State != "ready" {
		return nil, r, errors.New("runtime is not ready")
	}
	if raw, present := r.URL.Query()["sessionGeneration"]; present {
		if len(raw) != 1 {
			return nil, r, errors.New("invalid session generation")
		}
		generation, err := strconv.ParseInt(raw[0], 10, 64)
		if err != nil || generation < 0 || generation != item.SessionGeneration {
			return nil, r, errors.New("stale session generation")
		}
	}
	m.cancelBlockedShutdown(id)
	item = m.get(id)
	if item.SessionState != "running" && item.SessionState != "stopped" && item.SessionState != "failed" {
		return nil, r, errors.New("session transition is in progress")
	}
	if rfb {
		if err := m.attachRFBLocked(id); err != nil {
			return nil, r, err
		}
	} else {
		// The SDK opens its input and RFB sockets concurrently. Both are Viewer
		// intent; serialize activation so the input channel gets the winning epoch.
		if err := m.startSession(id); err != nil {
			return nil, r, err
		}
	}
	item = m.get(id)
	ctx, cancel := context.WithCancel(r.Context())
	channel := &viewerChannel{runtimeID: id, generation: item.SessionGeneration, rfb: rfb, cancel: cancel}
	m.mu.Lock()
	if m.viewerChannels == nil {
		m.viewerChannels = make(map[*viewerChannel]struct{})
	}
	m.viewerChannels[channel] = struct{}{}
	m.mu.Unlock()
	return channel, r.WithContext(ctx), nil
}

func (m *manager) bindViewerChannel(channel *viewerChannel, response *http.Response) error {
	if response.StatusCode != http.StatusSwitchingProtocols {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	_, owned := m.viewerChannels[channel]
	item := m.instances[channel.runtimeID]
	if !owned || item == nil || item.SessionGeneration != channel.generation || item.SessionState != "running" {
		response.Body.Close()
		return errors.New("Viewer generation retired before upgrade")
	}
	channel.body = response.Body
	return nil
}

func (m *manager) closeViewerChannel(channel *viewerChannel) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	_, owned := m.viewerChannels[channel]
	delete(m.viewerChannels, channel)
	item := m.instances[channel.runtimeID]
	current := item != nil && item.SessionGeneration == channel.generation
	m.mu.Unlock()
	channel.cancel()
	if owned && current && channel.rfb {
		m.detachRFBLocked(channel.runtimeID)
	}
	m.notifySessionRecovery()
}

// Unregistered client counts remain a veto. This includes legacy in-memory
// callers and uncertain ownership; never invent channel authority from a count.
func (m *manager) canFenceViewerChannels(item *instance) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	known := 0
	for channel := range m.viewerChannels {
		if channel.runtimeID == item.ID && channel.generation == item.SessionGeneration && channel.rfb {
			known++
		}
	}
	return known == item.AttachedClients
}

// Requires lifecycleMu and a committed charged intent. Remove ownership and
// counts atomically before close: late HTTP defers cannot touch the next epoch.
func (m *manager) fenceViewerChannels(item *instance) error {
	if !m.canFenceViewerChannels(item) {
		return errors.New("Viewer ownership is uncertain")
	}
	m.mu.Lock()
	var retired []*viewerChannel
	for channel := range m.viewerChannels {
		if channel.runtimeID == item.ID && channel.generation <= item.SessionGeneration {
			retired = append(retired, channel)
			delete(m.viewerChannels, channel)
		}
	}
	if live := m.instances[item.ID]; live != nil && live.SessionGeneration == item.SessionGeneration {
		live.AttachedClients = 0
	}
	m.mu.Unlock()
	for _, channel := range retired {
		channel.cancel()
		if channel.body != nil {
			channel.body.Close()
		}
	}
	return nil
}
