"""Extract immutable PPTX media with explicit slide lineage and visual previews."""

import hashlib, io, mimetypes, os, tempfile
from pathlib import Path
from zipfile import ZipFile
from PIL import Image, ImageOps
from media import ROOT, source, probe, contact_sheet, store_image
from jobs import ProcessingCancelled, check_cancelled, commit


def store_blob(data, mime):
    check_cancelled()
    digest = hashlib.sha256(data).hexdigest()
    key = f"assets/{digest[:2]}/{digest}"
    path = ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temporary.write(data)
            tmp = Path(temporary.name)
        try:
            commit(lambda: os.link(tmp, path))
        except FileExistsError:
            pass
        finally:
            tmp.unlink()
    return {"storageKey": key, "sha256": digest, "bytes": len(data), "mime": mime}


def all_shapes(shapes, grouped=False):
    for shape in shapes:
        check_cancelled()
        yield shape, grouped
        if shape.shape_type == 6:
            yield from all_shapes(shape.shapes, True)


def extract_media(path, presentation, units):
    associations = {}
    positions = {}
    external = set()

    def relate(part, n):
        for rel in part.rels.values():
            if not rel.reltype.endswith(("/image", "/video", "/media")):
                continue
            if rel.is_external:
                external.add(n)
                continue
            name = str(rel.target_part.partname).lstrip("/")
            if name.startswith("ppt/media/"):
                associations.setdefault(name, set()).add(n)

    for n, slide in enumerate(presentation.slides, 1):
        check_cancelled()
        for part in [
            slide.part,
            slide.slide_layout.part,
            slide.slide_layout.slide_master.part,
        ]:
            relate(part, n)
        for shape, grouped in all_shapes(slide.shapes):
            for node in shape._element.iter():
                for attribute, value in node.attrib.items():
                    if attribute.rsplit("}", 1)[-1] not in ("embed", "link"):
                        continue
                    if value not in slide.part.rels:
                        continue
                    rel = slide.part.rels[value]
                    if rel.is_external:
                        continue
                    name = str(rel.target_part.partname).lstrip("/")
                    if not name.startswith("ppt/media/"):
                        continue
                    associations.setdefault(name, set()).add(n)
                    if not grouped:
                        positions.setdefault(
                            name,
                            (
                                n,
                                int(shape.left),
                                int(shape.top),
                                int(shape.width),
                                int(shape.height),
                            ),
                        )
    result = []
    with ZipFile(path) as archive:
        for name in sorted(
            n
            for n in archive.namelist()
            if n.startswith("ppt/media/") and not n.endswith("/")
        ):
            check_cancelled()
            data = archive.read(name)
            suffix = Path(name).suffix.lower()
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            kind = (
                "video"
                if suffix in (".mp4", ".m4v", ".mov", ".wmv", ".avi", ".webm", ".mkv")
                else "image"
            )
            if kind == "video":
                mime = {
                    ".mp4": "video/mp4",
                    ".m4v": "video/mp4",
                    ".mov": "video/quicktime",
                    ".webm": "video/webm",
                }.get(suffix, mime)
            elif not mime.startswith("image/") and suffix not in (
                ".wdp",
                ".jxr",
                ".hdp",
                ".emf",
                ".wmf",
                ".dib",
            ):
                for number in associations.get(name, set()):
                    units[number - 1]["warnings"].append(
                        f"Unsupported embedded resource {name} remains in the original deck; it was not interpreted as an image."
                    )
                    units[number - 1]["complete"] = False
                continue
            original = store_blob(data, mime)
            previews = []
            warnings = []
            duration = None
            origin = "unavailable"
            unit_numbers = sorted(associations.get(name, set()))
            source_unit = unit_numbers[0] if unit_numbers else None
            if kind == "video":
                try:
                    meta = probe(source(original["storageKey"]))
                    duration = meta["durationMs"]
                    # Preview samples are explicitly bounded visual coverage, not a full audiovisual transcript.
                    times = sorted(
                        set(
                            min(duration - 1, round(duration * f))
                            for f in (0, 0.33, 0.67, 0.98)
                        )
                    )
                    sheet = contact_sheet(source(original["storageKey"]), times)
                    previews = [
                        {
                            "asset": f["asset"],
                            "width": f["width"],
                            "height": f["height"],
                            "requestedMs": f["requestedMs"],
                            "actualMs": f["actualMs"],
                        }
                        for f in sheet["frames"]
                    ]
                    origin = "video_frames"
                    warnings.append(
                        "Label uses four sampled video frames; motion between samples and embedded audio are not interpreted."
                    )
                except ProcessingCancelled:
                    raise
                except Exception:
                    warnings.append(
                        "Video bytes extracted; preview decoding unavailable. Inspect or download the original clip."
                    )
            else:
                try:
                    with Image.open(io.BytesIO(data)) as image:
                        if getattr(image, "n_frames", 1) > 1:
                            warnings.append(
                                "Animated image preview shows only the first frame."
                            )
                        image = ImageOps.exif_transpose(image).convert("RGBA")
                        image.thumbnail((1600, 1600))
                        rgb = Image.new("RGB", image.size, "white")
                        rgb.paste(image, mask=image.getchannel("A"))
                    previews = [
                        {
                            "asset": store_image(rgb),
                            "width": rgb.width,
                            "height": rgb.height,
                            "requestedMs": None,
                            "actualMs": None,
                        }
                    ]
                    origin = "decoded_image"
                except ProcessingCancelled:
                    raise
                except Exception:
                    position = positions.get(name)
                    if position:
                        n, left, top, width, height = position
                        with Image.open(
                            source(units[n - 1]["render"]["storageKey"])
                        ) as rendered:
                            scale_x = rendered.width / int(presentation.slide_width)
                            scale_y = rendered.height / int(presentation.slide_height)
                            box = (
                                max(0, round(left * scale_x)),
                                max(0, round(top * scale_y)),
                                min(rendered.width, round((left + width) * scale_x)),
                                min(rendered.height, round((top + height) * scale_y)),
                            )
                            if box[2] > box[0] and box[3] > box[1]:
                                crop = rendered.crop(box).convert("RGB")
                                previews = [
                                    {
                                        "asset": store_image(crop),
                                        "width": crop.width,
                                        "height": crop.height,
                                        "requestedMs": None,
                                        "actualMs": None,
                                    }
                                ]
                                origin = "slide_crop"
                                source_unit = n
                    warnings.append(
                        "Original image format is not directly decodable. Preview, if present, is cropped from its slide render and may include overlays."
                    )
            result.append(
                {
                    "sourcePart": name,
                    "kind": kind,
                    "original": original,
                    "unitNumbers": unit_numbers,
                    "previewSourceUnit": source_unit,
                    "previewOrigin": origin,
                    "previews": previews,
                    "durationMs": duration,
                    "warnings": warnings,
                }
            )
    for n in external:
        units[n - 1]["warnings"].append(
            "Externally linked media is not embedded and was not fetched."
        )
        units[n - 1]["complete"] = False
    return result
