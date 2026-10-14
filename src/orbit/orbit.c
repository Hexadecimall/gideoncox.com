#include <stdint.h>

#define COUNT 720
#define TAU 6.283185307f

/* Position, velocity, ring angle, cross-section angle, and depth per point. */
static float points[COUNT][7];
static uint32_t seed = 17;
static float rotation = 0;

static float absolute(float x) { return x < 0 ? -x : x; }
static float sine(float x) {
    while (x > 3.14159265f) x -= TAU;
    while (x < -3.14159265f) x += TAU;
    float value = 1.27323954f * x - .405284735f * x * absolute(x);
    return .225f * (value * absolute(value) - value) + value;
}
static float cosine(float x) { return sine(x + 1.57079633f); }
static float random_unit(void) {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return (seed & 65535) / 65535.0f;
}

__attribute__((export_name("orbit_buffer")))
float *orbit_buffer(void) { return &points[0][0]; }

__attribute__((export_name("orbit_count")))
int orbit_count(void) { return COUNT; }

__attribute__((export_name("orbit_step")))
void orbit_step(float delta, float pointer_x, float pointer_y, int active) {
    if (delta <= 0 || delta > .05f) return;
    rotation += delta * .14f;
    if (rotation > TAU) rotation -= TAU;
    for (int i = 0; i < COUNT; i++) {
        float *p = points[i];
        float theta = p[4] + rotation;
        float phi = p[5] + rotation * .4f;
        float radius = .67f + .23f * cosine(phi);
        float x = radius * cosine(theta);
        float y = radius * sine(theta);
        float z = .23f * sine(phi);
        /* A tilted ring, with a slow turn about its vertical axis. */
        float tilt = .9f + .22f * sine(rotation);
        float target_y = y * cosine(tilt) - z * sine(tilt);
        float depth = y * sine(tilt) + z * cosine(tilt);
        float target_x = x * cosine(rotation * .7f) + depth * sine(rotation * .7f);
        p[6] = depth;
        float ax = (target_x - p[0]) * 8;
        float ay = (target_y - p[1]) * 8;
        if (active) {
            float dx = p[0] - pointer_x;
            float dy = p[1] - pointer_y;
            float distance = dx * dx + dy * dy + .025f;
            if (distance < .24f) {
                ax += dx * .36f / distance;
                ay += dy * .36f / distance;
            }
        }
        float drag = 1 - 3.5f * delta;
        p[2] = (p[2] + ax * delta) * drag;
        p[3] = (p[3] + ay * delta) * drag;
        p[0] += p[2] * delta;
        p[1] += p[3] * delta;
    }
}

__attribute__((export_name("orbit_scatter")))
void orbit_scatter(void) {
    for (int i = 0; i < COUNT; i++) {
        float angle = random_unit() * TAU;
        float speed = 1.4f + random_unit() * 2;
        points[i][2] += cosine(angle) * speed;
        points[i][3] += sine(angle) * speed;
    }
}

__attribute__((export_name("orbit_init")))
void orbit_init(void) {
    rotation = 0;
    for (int i = 0; i < COUNT; i++) {
        points[i][4] = (i / 12) * TAU / 60;
        points[i][5] = (i % 12) * TAU / 12;
        points[i][0] = points[i][1] = 0;
        points[i][2] = points[i][3] = 0;
    }
    for (int i = 0; i < 200; i++) orbit_step(.016f, 0, 0, 0);
}
