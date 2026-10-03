#!/usr/bin/env python3
"""Apply the minimal Impress workspace to the test LibreOffice instance."""

import sys
import time

import uno


def connect():
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    url = "uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext"
    for _ in range(80):
        try:
            return resolver.resolve(url)
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("LibreOffice UNO socket did not become ready")


def current_document(desktop):
    for _ in range(80):
        try:
            document = desktop.getCurrentComponent()
            if document is not None:
                # Some freshly launched LibreOffice components do not expose
                # supportsService through the bridge yet. DrawPages is the
                # capability this layout actually needs and is stable for
                # Impress documents.
                document.getDrawPages()
                return document
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("Impress document did not become ready")


def ready_frame(document):
    """Wait until Impress has created and shown the main layout."""
    for _ in range(80):
        try:
            frame = document.getCurrentController().getFrame()
            layout = frame.LayoutManager
            window = frame.getContainerWindow()
            # Applying hideElement before the window is visible is silently
            # overwritten by Impress' own delayed UI initialization.
            if window.isVisible() and layout is not None:
                return frame, layout
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("Impress main window did not become ready")


def module_ui_configuration(service_manager, context):
    supplier = service_manager.createInstanceWithContext(
        "com.sun.star.ui.ModuleUIConfigurationManagerSupplier", context
    )
    return supplier.getUIConfigurationManager(
        "com.sun.star.presentation.PresentationDocument"
    )


def property_value(name, value):
    result = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    result.Name = name
    result.Value = value
    return result


def toolbar_item(command):
    return uno.Any(
        "[]com.sun.star.beans.PropertyValue",
        (
            property_value("CommandURL", command),
            property_value("Label", ""),
            property_value("Type", 0),
            property_value("IsVisible", True),
        ),
    )


def toolbar_separator():
    return uno.Any(
        "[]com.sun.star.beans.PropertyValue",
        (
            property_value("CommandURL", ""),
            property_value("Type", 1),
            property_value("IsVisible", True),
        ),
    )


def create_kiosk_toolbar(configuration):
    """Create one compact, ordered toolbar for the kiosk editor."""
    resource = "private:resource/toolbar/custom_toolbar_kiosk"
    if configuration.hasSettings(resource):
        configuration.removeSettings(resource)

    settings = configuration.createSettings()
    entries = (
        ".uno:PreviousSlide",
        ".uno:NextSlide",
        None,
        ".uno:Undo",
        ".uno:Redo",
        None,
        ".uno:CharFontName",
        ".uno:FontHeight",
        ".uno:Bold",
        ".uno:Italic",
        ".uno:Underline",
        ".uno:Color",
        None,
        ".uno:LeftPara",
        ".uno:CenterPara",
        ".uno:RightPara",
        None,
        ".uno:DefaultBullet",
        ".uno:DefaultNumbering",
    )
    for entry in entries:
        uno.invoke(
            settings,
            "insertByIndex",
            (settings.getCount(), toolbar_separator() if entry is None else toolbar_item(entry)),
        )
    configuration.insertSettings(resource, settings)
    return resource


def configure_toolbar(configuration, resource, visible_commands, append_commands=()):
    """Keep a controlled command subset on an existing Impress toolbar."""
    settings = configuration.getSettings(resource, True)
    present_commands = set()

    for index in range(settings.getCount()):
        properties = list(settings.getByIndex(index))
        command = next(
            (property_value.Value for property_value in properties
             if property_value.Name == "CommandURL"),
            "",
        )
        present_commands.add(command)
        properties = [
            property_value for property_value in properties
            if property_value.Name not in ("Visible", "IsVisible")
        ]
        properties.append(property_value("IsVisible", command in visible_commands))
        uno.invoke(
            settings,
            "replaceByIndex",
            (
                index,
                uno.Any("[]com.sun.star.beans.PropertyValue", tuple(properties)),
            ),
        )

    for command in append_commands:
        if command not in present_commands:
            uno.invoke(
                settings,
                "insertByIndex",
                (settings.getCount(), toolbar_item(command)),
            )

    configuration.replaceSettings(resource, settings)
    return resource


def main():
    context = connect()
    service_manager = context.ServiceManager
    desktop = service_manager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
    document = current_document(desktop)
    frame, layout = ready_frame(document)

    # Keep just the text-formatting toolbar and central slide canvas.
    for resource in (
        "private:resource/toolbar/standardbar",
        "private:resource/toolbar/drawingobjectbar",
        "private:resource/toolbar/toolbar",
        "private:resource/toolbar/textobjectbar",
        "private:resource/toolbar/fullscreenbar",
        "private:resource/toolbar/notebookbarshortcuts",
        "private:resource/toolbar/commontaskbar",
        "private:resource/statusbar/statusbar",
        "private:resource/menubar/menubar",
    ):
        try:
            layout.hideElement(resource)
        except Exception:
            pass

    formatting_toolbar = "private:resource/toolbar/textobjectbar"

    try:
        configuration = module_ui_configuration(service_manager, context)
        kiosk_toolbar = create_kiosk_toolbar(configuration)
        configure_toolbar(
            configuration,
            formatting_toolbar,
            set(),
        )
        configure_toolbar(configuration, "private:resource/toolbar/commontaskbar", set())
        configuration.store()

        # Prevent Impress from reintroducing context toolbars. The custom
        # toolbar remains visible whether or not a text box is selected.
        layout.setPropertyValue("AutomaticToolbars", False)
        for resource in (kiosk_toolbar,):
            if layout.getElement(resource) is not None:
                layout.hideElement(resource)
                layout.destroyElement(resource)
            layout.createElement(resource)
            layout.showElement(resource)
    except Exception as error:
        print(f"kiosk toolbar: {error}", file=sys.stderr)

    # Explicit properties make the clean layout deterministic with a freshly
    # created profile: no slide thumbnails and no properties sidebar.
    dispatcher = service_manager.createInstanceWithContext(
        "com.sun.star.frame.DispatchHelper", context
    )
    for command, property_name in (
        (".uno:Sidebar", "Sidebar"),
        (".uno:LeftPaneImpress", "LeftPaneImpress"),
    ):
        property_value = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
        property_value.Name = property_name
        property_value.Value = False
        try:
            dispatcher.executeDispatch(frame, command, "", 0, (property_value,))
        except Exception:
            pass



if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"configure-impress: {error}", file=sys.stderr)
        sys.exit(1)
