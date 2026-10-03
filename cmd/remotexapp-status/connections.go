package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func readIBusLaunch(path string) ([]byte, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("invalid private launch record")
	}
	return io.ReadAll(io.LimitReader(f, 4097))
}

func recordIBus(publicPath string, generation int64, pid int) error {
	return recordIBusAddress(publicPath, generation, pid, os.Getenv("IBUS_ADDRESS"))
}

func recordIBusAddress(publicPath string, generation int64, pid int, address string) error {
	if publicPath == "" || generation < 1 || pid < 0 {
		return errors.New("invalid launch identity")
	}
	value := map[string]any{"generation": generation, "enabled": pid != 0}
	if pid != 0 {
		if address == "" {
			return errors.New("missing address")
		}
		stat, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
		if err != nil {
			return err
		}
		end := strings.LastIndexByte(string(stat), ')')
		if end < 0 {
			return errors.New("invalid process")
		}
		fields := strings.Fields(string(stat)[end+1:])
		if len(fields) < 20 || fields[0] == "Z" {
			return errors.New("dead process")
		}
		if _, err := strconv.ParseUint(fields[19], 10, 64); err != nil {
			return err
		}
		value["address"], value["scope"], value["pid"], value["startTime"] = address, "runtime", pid, fields[19]
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(filepath.Dir(publicPath), "session-ibus-identity.json"), payload)
}

// Private data never enters application-status.json or public error messages.
func reportConnections(publicPath string, generation int64, state, application string) error {
	directory := filepath.Dir(publicPath)
	var values []string
	if payload, err := readIBusLaunch(filepath.Join(directory, "session-ibus-identity.json")); err == nil {
		var value map[string]any
		if len(payload) > 4096 || json.Unmarshal(payload, &value) != nil || value["generation"] != float64(generation) {
			return errors.New("invalid IBus generation")
		}
		values = append(values, "ibus="+string(payload))
	} else if !os.IsNotExist(err) {
		return err
	}
	if address := os.Getenv("DBUS_SESSION_BUS_ADDRESS"); address != "" {
		scope := "runtime"
		if os.Getenv("REMOTEXAPP_RUN_MODE") == "user-home" {
			scope = "user"
		}
		payload, err := json.Marshal(map[string]string{"address": address, "scope": scope})
		if err != nil {
			return err
		}
		values = append(values, "sessionBus="+string(payload))
	}
	if application != "" {
		values = append(values, "application="+application)
	}
	return report(filepath.Join(directory, "connection-status.json"), filepath.Join(directory, "connection-schema.json"), generation, state, "", "", nil, nil, nil, values)
}
