#!/bin/bash
cd "/home/HAIKB/enterprise-knowledge-drive/backend"
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 9090 2>&1
