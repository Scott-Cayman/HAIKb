from abc import ABC, abstractmethod
from typing import Any, Optional


class BaseIndex(ABC):
    """定义索引生命周期接口，保持与 kotaemon 的分层思路一致。"""

    def __init__(self, id: int, name: str, config: dict):
        self.id = id
        self.name = name
        self.config = config

    def on_create(self) -> None:
        pass

    def on_start(self) -> None:
        pass

    def on_delete(self) -> None:
        pass

    @abstractmethod
    def get_indexing_pipeline(self, settings: dict, user_id: Optional[int] = None) -> Any:
        raise NotImplementedError

    @abstractmethod
    def get_retriever_pipeline(self, settings: dict, user_id: Optional[int] = None) -> Any:
        raise NotImplementedError
