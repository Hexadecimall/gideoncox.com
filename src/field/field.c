#include <stdint.h>

static uint8_t drawing[160 * 96 * 4];
static int brush_size = 3;

__attribute__((export_name("set_brush_size")))
void set_brush_size(int size) { brush_size = size < 1 ? 1 : size > 9 ? 9 : size; }

__attribute__((export_name("drawing_buffer")))
uint8_t *drawing_buffer(void) { return drawing; }

__attribute__((export_name("clear_drawing")))
void clear_drawing(void) {
    for (int i = 0; i < 160 * 96 * 4; i += 4) {
        drawing[i] = 19;
        drawing[i + 1] = 24;
        drawing[i + 2] = 29;
        drawing[i + 3] = 255;
    }
}

static void brush(int x, int y, uint32_t color) {
    for (int py = y - brush_size / 2; py < y - brush_size / 2 + brush_size; ++py) {
        for (int px = x - brush_size / 2; px < x - brush_size / 2 + brush_size; ++px) {
            if (px < 0 || px >= 160 || py < 0 || py >= 96) continue;
            int i = (py * 160 + px) * 4;
            drawing[i] = (color >> 16) & 255;
            drawing[i + 1] = (color >> 8) & 255;
            drawing[i + 2] = color & 255;
            drawing[i + 3] = 255;
        }
    }
}

__attribute__((export_name("draw_line")))
void draw_line(int x0, int y0, int x1, int y1, uint32_t color) {
    if (x0 < 0 || x0 >= 160 || x1 < 0 || x1 >= 160 ||
        y0 < 0 || y0 >= 96 || y1 < 0 || y1 >= 96) return;
    int dx = x1 > x0 ? x1 - x0 : x0 - x1;
    int dy = y1 > y0 ? y0 - y1 : y1 - y0;
    int sx = x0 < x1 ? 1 : -1;
    int sy = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    for (;;) {
        brush(x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int twice = 2 * error;
        if (twice >= dy) { error += dy; x0 += sx; }
        if (twice <= dx) { error += dx; y0 += sy; }
    }
}
