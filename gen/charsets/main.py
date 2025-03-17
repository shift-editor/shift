import charsets
import json
import os


dirname = os.path.dirname(__file__)
data = os.path.join(dirname, "../../apps/desktop/data")


def generate_ts_file(charset: str):
    const_name = charset.upper().replace(" ", "_").replace("-", "_")
    adobe = charsets.generate_adobe_charsets()
    ts_content = f"""// Generated file - do not edit directly
// {charset} character set


export const {const_name} = {json.dumps(adobe, indent=2, ensure_ascii=False)}
"""

    return ts_content


def main():
    content = generate_ts_file("adobe-latin-1")
    path = os.path.join(data, "adobe-latin-1.ts")
    with open(path, "w") as f:
        f.write(content)


if __name__ == "__main__":
    main()
