package main

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/unix"
)

type managedRuntimeEvent struct {
	ManagedID string
	RuntimeID string
	Unit      string
}

type sessionRuntimeEvent struct {
	InstanceID string
	Generation int64
	Unit       string
	Reason     string
}

type managedRuntimeObserver interface {
	Watch(managedID string, runtime *instance) error
	Unwatch(runtimeID string)
	Close() error
}

type sessionRuntimeObserver interface {
	WatchSession(instanceID string, generation int64, unit string) error
	UnwatchSession(instanceID string, generation int64)
}

type cgroupWatchKind uint8

const (
	managedCgroupWatch cgroupWatchKind = iota + 1
	sessionCgroupWatch
)

type watchedCgroup struct {
	kind       cgroupWatchKind
	managedID  string
	runtimeID  string
	instanceID string
	generation int64
	unit       string
	path       string
	reported   bool
}

type cgroupRuntimeObserver struct {
	root          string
	uid           int
	standalone    bool
	fd            int
	wakeRead      int
	wakeWrite     int
	notifyManaged func(managedRuntimeEvent)
	notifySession func(sessionRuntimeEvent)
	mu            sync.Mutex
	reader        sync.WaitGroup
	byWatch       map[int]*watchedCgroup
	byRuntime     map[string][]int
	bySession     map[string][]int
	closed        bool
}

func newCgroupRuntimeObserver(root string, uid int, notifyManaged func(managedRuntimeEvent), notifySession func(sessionRuntimeEvent), standalone ...bool) (*cgroupRuntimeObserver, error) {
	fd, err := unix.InotifyInit1(unix.IN_CLOEXEC | unix.IN_NONBLOCK)
	if err != nil {
		return nil, err
	}
	wake := []int{0, 0}
	if err := unix.Pipe2(wake, unix.O_CLOEXEC|unix.O_NONBLOCK); err != nil {
		_ = unix.Close(fd)
		return nil, err
	}
	observer := &cgroupRuntimeObserver{
		root: root, uid: uid, fd: fd, wakeRead: wake[0], wakeWrite: wake[1],
		notifyManaged: notifyManaged, notifySession: notifySession,
		byWatch: make(map[int]*watchedCgroup), byRuntime: make(map[string][]int), bySession: make(map[string][]int),
	}
	observer.standalone = len(standalone) > 0 && standalone[0]
	observer.reader.Add(1)
	go observer.readEvents()
	return observer, nil
}

func cgroupEventPath(root string, uid int, unit string) string {
	return filepath.Join(root, "user.slice", "user-"+strconv.Itoa(uid)+".slice", "user@"+strconv.Itoa(uid)+".service", "app.slice", unit, "cgroup.events")
}

func (o *cgroupRuntimeObserver) eventPath(unit string) string {
	if o.standalone {
		return filepath.Join(o.root, unit, "cgroup.events")
	}
	return cgroupEventPath(o.root, o.uid, unit)
}

func cgroupPopulated(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && fields[0] == "populated" {
			return fields[1] == "1", nil
		}
	}
	if err := scanner.Err(); err != nil {
		return false, err
	}
	return false, errors.New("cgroup.events has no populated field")
}

func (o *cgroupRuntimeObserver) Watch(managedID string, runtime *instance) error {
	if runtime == nil || runtime.ID == "" {
		return errors.New("runtime is required")
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return errors.New("observer is closed")
	}
	if len(o.byRuntime[runtime.ID]) != 0 {
		return nil
	}
	units := []string{runtime.VNCUnit, runtime.GatewayUnit}
	added := make([]int, 0, len(units))
	for _, unit := range units {
		if unit == "" {
			o.removeWatchesLocked(added)
			return errors.New("runtime VNC and gateway units are required")
		}
		path := o.eventPath(unit)
		watch, err := unix.InotifyAddWatch(o.fd, path, unix.IN_MODIFY|unix.IN_ATTRIB|unix.IN_DELETE_SELF|unix.IN_MOVE_SELF)
		if err != nil {
			o.removeWatchesLocked(added)
			return fmt.Errorf("watch %s: %w", unit, err)
		}
		entry := &watchedCgroup{kind: managedCgroupWatch, managedID: managedID, runtimeID: runtime.ID, unit: unit, path: path}
		o.byWatch[watch] = entry
		added = append(added, watch)
		populated, err := cgroupPopulated(path)
		if err != nil || !populated {
			o.removeWatchesLocked(added)
			if err != nil {
				return fmt.Errorf("read %s: %w", unit, err)
			}
			return fmt.Errorf("unit %s cgroup is not populated", unit)
		}
	}
	o.byRuntime[runtime.ID] = added
	return nil
}

func sessionWatchKey(instanceID string, generation int64) string {
	return instanceID + "/" + strconv.FormatInt(generation, 10)
}

func (o *cgroupRuntimeObserver) WatchSession(instanceID string, generation int64, unit string) error {
	if instanceID == "" || generation < 0 || unit == "" {
		return errors.New("session instance, generation and unit are required")
	}
	key := sessionWatchKey(instanceID, generation)
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return errors.New("observer is closed")
	}
	if len(o.bySession[key]) != 0 {
		return nil
	}
	path := o.eventPath(unit)
	watch, err := unix.InotifyAddWatch(o.fd, path, unix.IN_MODIFY|unix.IN_ATTRIB|unix.IN_DELETE_SELF|unix.IN_MOVE_SELF)
	if err != nil {
		return fmt.Errorf("watch %s: %w", unit, err)
	}
	o.byWatch[watch] = &watchedCgroup{
		kind: sessionCgroupWatch, instanceID: instanceID, generation: generation, unit: unit, path: path,
	}
	populated, err := cgroupPopulated(path)
	if err != nil || !populated {
		o.removeWatchesLocked([]int{watch})
		if err != nil {
			return fmt.Errorf("read %s: %w", unit, err)
		}
		return fmt.Errorf("unit %s cgroup is not populated", unit)
	}
	o.bySession[key] = []int{watch}
	return nil
}

func (o *cgroupRuntimeObserver) removeWatchesLocked(watches []int) {
	for _, watch := range watches {
		delete(o.byWatch, watch)
		_, _ = unix.InotifyRmWatch(o.fd, uint32(watch))
	}
}

func (o *cgroupRuntimeObserver) Unwatch(runtimeID string) {
	o.mu.Lock()
	watches := o.byRuntime[runtimeID]
	delete(o.byRuntime, runtimeID)
	o.removeWatchesLocked(watches)
	o.mu.Unlock()
}

func (o *cgroupRuntimeObserver) UnwatchSession(instanceID string, generation int64) {
	key := sessionWatchKey(instanceID, generation)
	o.mu.Lock()
	watches := o.bySession[key]
	delete(o.bySession, key)
	o.removeWatchesLocked(watches)
	o.mu.Unlock()
}

func (o *cgroupRuntimeObserver) Close() error {
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return nil
	}
	o.closed = true
	wakeWrite := o.wakeWrite
	o.mu.Unlock()
	_, wakeErr := unix.Write(wakeWrite, []byte{1})
	if wakeErr != nil && !errors.Is(wakeErr, unix.EAGAIN) {
		return wakeErr
	}
	o.reader.Wait()
	closeErr := errors.Join(unix.Close(o.fd), unix.Close(o.wakeRead), unix.Close(o.wakeWrite))
	return closeErr
}

func (o *cgroupRuntimeObserver) readEvents() {
	defer o.reader.Done()
	buffer := make([]byte, 16<<10)
	poll := []unix.PollFd{
		{Fd: int32(o.fd), Events: unix.POLLIN},
		{Fd: int32(o.wakeRead), Events: unix.POLLIN},
	}
	for {
		_, err := unix.Poll(poll, -1)
		if err != nil {
			if errors.Is(err, unix.EINTR) {
				continue
			}
			return
		}
		if poll[1].Revents != 0 {
			return
		}
		if poll[0].Revents&unix.POLLIN == 0 {
			continue
		}
		n, err := unix.Read(o.fd, buffer)
		if err != nil {
			if errors.Is(err, unix.EINTR) || errors.Is(err, unix.EAGAIN) {
				continue
			}
			return
		}
		for offset := 0; offset+unix.SizeofInotifyEvent <= n; {
			event := (*unix.InotifyEvent)(unsafe.Pointer(&buffer[offset]))
			o.handleEvent(int(event.Wd), uint32(event.Mask))
			offset += unix.SizeofInotifyEvent + int(event.Len)
		}
	}
}

func (o *cgroupRuntimeObserver) handleEvent(watch int, mask uint32) {
	o.mu.Lock()
	entry := o.byWatch[watch]
	if entry == nil || entry.reported {
		o.mu.Unlock()
		return
	}
	terminal := mask&(unix.IN_DELETE_SELF|unix.IN_MOVE_SELF|unix.IN_IGNORED) != 0
	o.mu.Unlock()

	failed := terminal
	if !failed && mask&(unix.IN_MODIFY|unix.IN_ATTRIB) != 0 {
		populated, err := cgroupPopulated(entry.path)
		failed = err != nil || !populated
	}
	if !failed {
		return
	}
	o.mu.Lock()
	current := o.byWatch[watch]
	if current == nil || current.reported {
		o.mu.Unlock()
		return
	}
	current.reported = true
	o.mu.Unlock()
	if entry.kind == managedCgroupWatch && o.notifyManaged != nil {
		o.notifyManaged(managedRuntimeEvent{ManagedID: entry.managedID, RuntimeID: entry.runtimeID, Unit: entry.unit})
	}
	if entry.kind == sessionCgroupWatch && o.notifySession != nil {
		o.notifySession(sessionRuntimeEvent{InstanceID: entry.instanceID, Generation: entry.generation, Unit: entry.unit})
	}
}

func (m *manager) queueManagedRuntimeEvent(event managedRuntimeEvent) {
	select {
	case m.managedEvents <- event:
	default:
		log.Printf("managed runtime event queue full; safety reconciliation will recover %s", event.RuntimeID)
	}
}

func (m *manager) reconcileManagedEvents() {
	for event := range m.managedEvents {
		m.lifecycleMu.Lock()
		m.managedMu.RLock()
		item := m.managed[event.ManagedID]
		current := item != nil && item.Runtime != nil && item.Runtime.ID == event.RuntimeID
		m.managedMu.RUnlock()
		if current {
			log.Printf("managed instance %s observed empty unit cgroup %s", event.ManagedID, event.Unit)
			if err := m.reconcileManagedLocked(event.ManagedID); err != nil {
				log.Printf("managed instance %s event reconciliation: %v", event.ManagedID, err)
			}
		}
		m.lifecycleMu.Unlock()
	}
}
