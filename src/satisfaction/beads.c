#define EXPORT(name) __attribute__((export_name(name)))
#define COLUMNS 25
#define ROWS 15
#define COUNT (COLUMNS * ROWS)

typedef struct { float x, y, vx, vy, home_x, home_y; } Bead;
static Bead beads[COUNT];

EXPORT("beads_reset")
void beads_reset(void) {
    for (int i = 0; i < COUNT; ++i) {
        float x = 48 + (i % COLUMNS) * 26;
        float y = 38 + (i / COLUMNS) * 26;
        beads[i] = (Bead){x, y, 0, 0, x, y};
    }
}

EXPORT("beads_step")
void beads_step(float dt, float pointer_x, float pointer_y, int pressed) {
    if (dt <= 0 || dt > 0.02f) return;
    for (int i = 0; i < COUNT; ++i) {
        Bead *b = &beads[i];
        float dx = pointer_x - b->x, dy = pointer_y - b->y;
        float distance_squared = dx * dx + dy * dy;
        // A local force bends the grid; spring tension restores every bead.
        float force = distance_squared < 40000 ? (pressed ? 28000 : -10000) / (distance_squared + 1400) : 0;
        b->vx += ((b->home_x - b->x) * 24 + dx * force - b->vx * 7) * dt;
        b->vy += ((b->home_y - b->y) * 24 + dy * force - b->vy * 7) * dt;
        b->x += b->vx * dt;
        b->y += b->vy * dt;
    }
}

EXPORT("beads_value")
float beads_value(int index, int axis) {
    if (index < 0 || index >= COUNT) return 0;
    return axis == 0 ? beads[index].x : beads[index].y;
}

EXPORT("beads_count")
int beads_count(void) { return COUNT; }
