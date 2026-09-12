from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """DB 연결 설정에 의존하지 않는 공통 ORM 기반 클래스."""

    pass
