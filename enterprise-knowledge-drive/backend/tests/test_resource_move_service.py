from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
from app.services.resource_move_service import ResourceMoveError, move_file, move_folder


class ResourceMoveServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[User.__table__, Folder.__table__, File.__table__],
        )
        self.db = Session(self.engine)

        self.root = Folder(name="企业知识库", parent_id=None, department_name="总部")
        self.source = Folder(name="来源", parent_id=None, department_name="创意中心")
        self.target = Folder(name="目标", parent_id=None, department_name="培训中心")
        self.other_root = Folder(name="其他知识库", parent_id=None, department_name="外部")
        self.db.add_all([self.root, self.source, self.target, self.other_root])
        self.db.flush()
        self.source.parent_id = self.root.id
        self.target.parent_id = self.root.id
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_file_moves_without_changing_storage_or_identity(self) -> None:
        file = File(
            folder_id=self.source.id,
            original_name="培训资料.pdf",
            stored_name="fixed-id.pdf",
            storage_path="/storage/originals/fixed-id.pdf",
            department_name="创意中心",
        )
        self.db.add(file)
        self.db.flush()

        result = move_file(self.db, file, self.target)
        self.db.flush()

        self.assertEqual(file.id, result.resource_id)
        self.assertEqual(file.folder_id, self.target.id)
        self.assertEqual(file.storage_path, "/storage/originals/fixed-id.pdf")
        self.assertEqual(file.department_name, "培训中心")

    def test_file_move_rejects_case_insensitive_name_conflict(self) -> None:
        source_file = File(
            folder_id=self.source.id,
            original_name="Training.PDF",
            stored_name="source.pdf",
            storage_path="/storage/source.pdf",
        )
        existing_file = File(
            folder_id=self.target.id,
            original_name="training.pdf",
            stored_name="target.pdf",
            storage_path="/storage/target.pdf",
        )
        self.db.add_all([source_file, existing_file])
        self.db.flush()

        with self.assertRaisesRegex(ResourceMoveError, "同名文件"):
            move_file(self.db, source_file, self.target)

    def test_folder_cannot_move_into_its_descendant(self) -> None:
        child = Folder(name="子目录", parent_id=self.source.id, department_name="创意中心")
        self.db.add(child)
        self.db.flush()

        with self.assertRaisesRegex(ResourceMoveError, "自身或其子目录"):
            move_folder(self.db, self.source, child)

    def test_folder_move_updates_subtree_department_metadata(self) -> None:
        child = Folder(name="子目录", parent_id=self.source.id, department_name="创意中心")
        self.db.add(child)
        self.db.flush()
        nested_file = File(
            folder_id=child.id,
            original_name="方案.docx",
            stored_name="plan.docx",
            storage_path="/storage/plan.docx",
            department_name="创意中心",
        )
        self.db.add(nested_file)
        self.db.flush()

        move_folder(self.db, self.source, self.target)
        self.db.flush()
        self.db.expire_all()

        moved_source = self.db.get(Folder, self.source.id)
        moved_child = self.db.get(Folder, child.id)
        moved_file = self.db.get(File, nested_file.id)
        self.assertEqual(moved_source.parent_id, self.target.id)
        self.assertEqual(moved_child.department_name, "培训中心")
        self.assertEqual(moved_file.department_name, "培训中心")

    def test_cross_root_move_is_rejected(self) -> None:
        with self.assertRaisesRegex(ResourceMoveError, "跨根目录"):
            move_folder(self.db, self.source, self.other_root)


if __name__ == "__main__":
    unittest.main()
