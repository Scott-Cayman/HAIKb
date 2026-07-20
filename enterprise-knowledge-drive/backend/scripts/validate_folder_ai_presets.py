from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models.folder import Folder
from app.models.user import User
from app.services.folder_ai_preset_service import folder_ai_preset_service
from app.services.resource_access import list_visible_folders


def visible_folder_ids(db, user):
    folders = db.query(Folder).filter(Folder.is_deleted == False).all()
    return [folder.id for folder in list_visible_folders(db, folders, user)]


def main():
    with SessionLocal() as db:
        cross_user = db.query(User).filter(User.id == 27).first()
        wine_user = db.query(User).filter(User.id == 121).first()
        if not cross_user or not wine_user:
            raise RuntimeError("Expected validation users 27 and 121")

        cross_scope = visible_folder_ids(db, cross_user)
        wine_scope = visible_folder_ids(db, wine_user)
        test_queries = ["会议室怎么订", "办公用品在哪申请", "项目付款要走什么流程", "我想开发票", "报价怎么做"]
        timings = []
        for query in test_queries:
            started = time.perf_counter()
            match = folder_ai_preset_service.match(db, query=query, visible_folder_ids=cross_scope)
            elapsed = (time.perf_counter() - started) * 1000
            timings.append(elapsed)
            print(
                f"CROSS query={query} matched={match.matched} type={match.match_type} "
                f"score={match.score:.4f} margin={match.margin:.4f} folder={match.folder_id} "
                f"question={match.question} elapsed_ms={elapsed:.1f}"
            )

        wine_match = folder_ai_preset_service.match(db, query="会议室怎么订", visible_folder_ids=wine_scope)
        print(
            f"WINE query=会议室怎么订 matched={wine_match.matched} folder={wine_match.folder_id} "
            f"candidate_count={wine_match.candidate_count}"
        )
        assert all(
            folder_ai_preset_service.match(db, query=query, visible_folder_ids=cross_scope).folder_id == 80
            for query in test_queries
        ), "Cross user should match folder 80 presets"
        assert wine_match.folder_id != 80, "Wine user must not match cross-marketing presets"
        print(f"PERF median_ms={statistics.median(timings):.1f} max_ms={max(timings):.1f}")


if __name__ == "__main__":
    main()
