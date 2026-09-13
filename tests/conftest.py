"""Make the shared fixture module importable from the tests beside it."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
