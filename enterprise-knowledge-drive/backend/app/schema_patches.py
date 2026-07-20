from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_user_department_paths_column(engine: Engine) -> None:
    inspector = inspect(engine)
    if "users" not in set(inspector.get_table_names()):
        return
    existing_columns = {column["name"] for column in inspector.get_columns("users")}
    statements = []
    if "department_paths" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN department_paths VARCHAR")
    if "department_manually_overridden" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN department_manually_overridden BOOLEAN DEFAULT FALSE")
    if statements:
        with engine.connect() as connection:
            for statement in statements:
                connection.execute(text(statement))
            connection.execute(text("UPDATE users SET department_manually_overridden = FALSE WHERE department_manually_overridden IS NULL"))
            connection.commit()


def ensure_folder_visual_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_columns = {column["name"] for column in inspector.get_columns("folders")}

    statements = []
    if "display_mode" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN display_mode VARCHAR DEFAULT 'icon'")
    if "icon_key" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN icon_key VARCHAR")
    if "icon_bg_from" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN icon_bg_from VARCHAR")
    if "icon_bg_to" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN icon_bg_to VARCHAR")
    if "icon_color" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN icon_color VARCHAR")
    if "card_bg_from" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN card_bg_from VARCHAR")
    if "card_bg_via" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN card_bg_via VARCHAR")
    if "card_bg_to" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN card_bg_to VARCHAR")
    if "card_glow_color" not in existing_columns:
        statements.append("ALTER TABLE folders ADD COLUMN card_glow_color VARCHAR")

    if statements:
        with engine.connect() as connection:
            for statement in statements:
                connection.execute(text(statement))
            connection.commit()

    with engine.connect() as connection:
        connection.execute(
            text(
                """
                UPDATE folders
                SET
                    display_mode = COALESCE(display_mode, 'icon'),
                    icon_key = COALESCE(icon_key, 'book-open'),
                    icon_bg_from = COALESCE(icon_bg_from, '#8cf3d5'),
                    icon_bg_to = COALESCE(icon_bg_to, '#44d7cc'),
                    icon_color = COALESCE(icon_color, '#ffffff'),
                    card_bg_from = COALESCE(card_bg_from, '#ebfff7'),
                    card_bg_via = COALESCE(card_bg_via, '#d8fff3'),
                    card_bg_to = COALESCE(card_bg_to, '#c1f7ec'),
                    card_glow_color = COALESCE(card_glow_color, '#ffffff')
                """
            )
        )
        connection.commit()


def ensure_resource_permission_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "resource_permissions" not in table_names:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("resource_permissions")}
    statements = []

    if "action" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN action VARCHAR")
    if "capability" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN capability VARCHAR")
    if "subject_type" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN subject_type VARCHAR")
    if "subject_value" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN subject_value VARCHAR")
    if "inherit_to_children" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN inherit_to_children BOOLEAN DEFAULT TRUE")
    if "created_by" not in existing_columns:
        statements.append("ALTER TABLE resource_permissions ADD COLUMN created_by INTEGER")

    if statements:
        with engine.connect() as connection:
            for statement in statements:
                connection.execute(text(statement))
            connection.commit()

    with engine.connect() as connection:
        connection.execute(
            text(
                """
                UPDATE resource_permissions
                SET
                    capability = COALESCE(capability, action),
                    action = COALESCE(action, capability),
                    inherit_to_children = COALESCE(inherit_to_children, TRUE)
                """
            )
        )
        connection.commit()


def ensure_file_preview_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "files" not in set(inspector.get_table_names()):
        return

    existing_columns = {column["name"] for column in inspector.get_columns("files")}
    statements = []
    column_definitions = {
        "preview_kind": "VARCHAR",
        "preview_pages_path": "VARCHAR",
        "preview_page_count": "INTEGER DEFAULT 0",
        "preview_error": "TEXT",
        "thumbnail_path": "VARCHAR",
        "thumbnail_status": "VARCHAR DEFAULT 'pending'",
    }
    for column_name, definition in column_definitions.items():
        if column_name not in existing_columns:
            statements.append(f"ALTER TABLE files ADD COLUMN {column_name} {definition}")

    if statements:
        with engine.connect() as connection:
            for statement in statements:
                connection.execute(text(statement))
            connection.execute(
                text(
                    """
                    UPDATE files
                    SET
                        preview_page_count = COALESCE(preview_page_count, 0),
                        thumbnail_status = COALESCE(thumbnail_status, 'pending')
                    """
                )
            )
            connection.commit()
