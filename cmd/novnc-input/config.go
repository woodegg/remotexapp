package main

type config struct {
	listen              string
	display             string
	vncAddr             string
	legacyRFB           string
	unoURL              string
	textBackend         string
	textLogLevel        string
	imeSocket           string
	ibusFocusClass      string
	maxRFBConnections   int
	maxInputConnections int
	clipboardSocket     string
}
