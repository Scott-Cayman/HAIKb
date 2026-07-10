from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


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
