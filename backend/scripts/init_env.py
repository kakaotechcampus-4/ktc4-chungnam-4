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
    placeholder = "replace-with-a-generated-password"
    password_lines = [
        line for line in content.splitlines()
        if line.partition("=")[0].strip() == "POSTGRES_PASSWORD"
    ]
    # 주석에만 예시 문구가 남거나 비밀번호 항목이 중복된 경우도 생성 전에 중단합니다.
    if len(password_lines) != 1 or password_lines[0].partition("=")[2].strip() != placeholder:
        raise SystemExit(
            "Invalid .env.example: expected exactly one "
            "POSTGRES_PASSWORD=replace-with-a-generated-password entry. "
            "No .env file was written."
        )
    lines = content.splitlines(keepends=True)
    password_index = next(
        index for index, line in enumerate(lines)
        if line.rstrip("\r\n") == password_lines[0]
    )
    lines[password_index] = f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n"
    content = "".join(lines)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as env_file:
        env_file.write(content)
    destination.chmod(0o600)
    print("Created backend/.env with a generated database password (not displayed).")


if __name__ == "__main__":
    main()
