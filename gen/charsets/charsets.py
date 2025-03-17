import requests
import re

UNICODE_BLOCKS_URL = "https://www.unicode.org/Public/14.0.0/ucd/Blocks.txt"
ADOBE_LATIN = "https://adobe-type-tools.github.io/adobe-latin-charsets/"


def generate_unicode_block_ranges():
    ucd_blocks = requests.get(UNICODE_BLOCKS_URL)

    block_map = {}
    for line in ucd_blocks.text.splitlines():
        if line.startswith("#") or line.startswith("\n"):
            continue

        if not line:
            continue

        data = re.split(r"[..;]+", line)
        block_map[data[2].strip()] = {
            "start": int(data[0], 16),
            "end": int(data[1], 16),
        }

    return block_map


def generate_adobe_charsets():
    adobe = requests.get(ADOBE_LATIN + "adobe-latin-1" + ".txt")
    adobe_map = {}

    for line in adobe.text.splitlines()[1:]:
        item = line.split("\t")
        unicode, name, char_name = item[0], item[2], item[3]
        adobe_map[name] = {"unicode": unicode, "char_name": char_name}

    return adobe_map
