"""Create a private .env once without printing the generated password."""

from pathlib import Path
import os
import secrets


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    destination = root / ".env"
    if destination.exists() and destination.stat().st_size:
        print("Existing backend/.env kept. No values changed.")
        return

    content = (root / ".env.example").read_text(encoding="utf-8")
    content = content.replace("replace-with-a-generated-password", secrets.token_urlsafe(32))
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as env_file:
        env_file.write(content)
    destination.chmod(0o600)
    print("Created backend/.env with a generated database password (not displayed).")


if __name__ == "__main__":
    main()
