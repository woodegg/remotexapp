#!/usr/bin/python3
"""Verify that one loopback LibreOffice UNO endpoint opened the requested file."""

from pathlib import Path
import sys

import uno


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("control port and document path are required")
    port = int(sys.argv[1])
    expected_url = Path(sys.argv[2]).resolve().as_uri() if sys.argv[2] else None
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    remote_context = resolver.resolve(
        f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    )
    desktop = remote_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.frame.Desktop", remote_context
    )
    if expected_url is None:
        # Prove UNO Desktop is callable; Start Center need not have a document.
        desktop.getComponents()
        return
    document = desktop.getCurrentComponent()
    if document is None or document.URL != expected_url:
        raise RuntimeError("requested LibreOffice document is not active")


if __name__ == "__main__":
    main()
