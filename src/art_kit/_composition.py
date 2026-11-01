"""Contact sheets and row-major image composition without asset or output policy."""

from PIL import Image


def contact_sheet(resolve_rgb, sprites, grounds, *, background, scale=3, gap=4):
    """One row per sprite and ground, preserving tag/frame and pixel order."""
    rows = []
    for _, tags in sprites:
        frames = [frame for _, tag_frames, _ in tags for frame in tag_frames]
        rows.extend((frames, ground) for ground in grounds)
    cell_width = max(len(frames[0][0]) for frames, _ in rows) + gap
    cell_heights = [len(frames[0]) + gap for frames, _ in rows]
    width = max(len(frames) for frames, _ in rows) * cell_width * scale
    image = Image.new("RGB", (width, sum(cell_heights) * scale), background)
    y0 = 0
    for (frames, ground), height in zip(rows, cell_heights, strict=True):
        for i, frame in enumerate(frames):
            for y, row in enumerate(frame):
                for x, colour in enumerate(row):
                    image.paste(
                        resolve_rgb(colour or ground),
                        (
                            (i * cell_width + x) * scale,
                            (y0 + y) * scale,
                            (i * cell_width + x + 1) * scale,
                            (y0 + y + 1) * scale,
                        ),
                    )
        y0 += height
    return image


def tile_sheet(tile_size, columns, tiles):
    """Alpha-composite images into a row-major sheet with no spacing or margins."""
    rows = -(-len(tiles) // columns)
    image = Image.new("RGBA", (columns * tile_size, rows * tile_size), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        image.alpha_composite(tile, ((i % columns) * tile_size, (i // columns) * tile_size))
    return image
