"""Download a real official Qwen GGUF file into this tests directory."""
from pathlib import Path
from huggingface_hub import hf_hub_download

TESTS_DIR = Path(__file__).resolve().parent
MODEL = "qwen2.5-0.5b-instruct-q4_0.gguf"
downloaded_path = hf_hub_download(
    repo_id="Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    filename=MODEL,
    local_dir=str(TESTS_DIR),
)
model_path = Path(downloaded_path)
if model_path.stat().st_size < 100_000_000:
    raise RuntimeError("GGUF model appears truncated")
with model_path.open("rb") as handle:
    if handle.read(4) != b"GGUF":
        raise RuntimeError("File does not contain the GGUF header")
print(f"\n下载完成！文件已保存至: {model_path}")
