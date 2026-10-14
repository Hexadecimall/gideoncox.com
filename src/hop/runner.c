#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(name)))
#define GROUND 218.0f
#define SIZE 22.0f
#define PLAYER_X 110.0f

enum ObstacleKind { BLOCK, GAP, FLYER, OVERHANG };
typedef struct { float x, width, height; int kind; } Obstacle;
static Obstacle obstacles[4];
static float y, velocity, distance, speed, x, angle, launch_time;
static int state, jumps, launched, duck_held, crouching;

static float player_height(void) { return crouching ? 12.0f : SIZE; }
static uint32_t seed;

static uint32_t random_value(void) {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return seed;
}

static void place(int i, float x) {
    obstacles[i].x = x;
    uint32_t roll = random_value();
    int kind = distance > 0 ? roll % 4 : (roll % 3 == 0 ? GAP : BLOCK);
    if (distance == 0 && i == 1) kind = OVERHANG;
    if (distance == 0 && i == 2) kind = FLYER;
    obstacles[i].kind = kind;
    uint32_t width = random_value();
    obstacles[i].width = kind == GAP ? 78 + width % 35
        : kind == OVERHANG ? 76 + width % 25 : kind == FLYER ? 30 : 22 + width % 14;
    obstacles[i].height = 26 + random_value() % 17;
}

EXPORT("runner_reset")
void runner_reset(uint32_t value) {
    seed = value ? value : 1;
    y = GROUND - SIZE;
    velocity = distance = 0;
    x = PLAYER_X;
    angle = 0;
    launched = 0;
    duck_held = crouching = 0;
    launch_time = 0;
    speed = 210;
    state = 1;
    jumps = 0;
    for (int i = 0; i < 4; ++i) place(i, 640 + i * 355);
}

EXPORT("runner_jump")
int runner_jump(void) {
    if (state != 1 || jumps >= 2 || y > 265) return 0;
    if (crouching) { y -= SIZE - 12; crouching = 0; }
    velocity = jumps == 0 ? -390 : -365;
    ++jumps;
    return 1;
}

EXPORT("runner_duck")
void runner_duck(int held) { duck_held = held != 0; }

static float obstacle_top(const Obstacle *obstacle) {
    if (obstacle->kind == FLYER) {
        float phase = (int)(distance * 0.3f) % 40;
        return 173 + (phase < 20 ? phase : 40 - phase) * 0.2f;
    }
    if (obstacle->kind == OVERHANG) return 148;
    return GROUND - obstacle->height;
}

EXPORT("runner_step")
void runner_step(float dt) {
    if (dt <= 0 || dt > 0.02f) return;
    if (state == 3) {
        launch_time += dt;
        if (launch_time < 0.4f) return;
        x += 480 * dt;
        velocity += 300 * dt;
        y += velocity * dt;
        angle += 22 * dt;
        if (y + SIZE < -40 || x > 760) state = 2;
        return;
    }
    if (state != 1) return;
    int next_crouch = duck_held && jumps == 0 && y + player_height() >= GROUND - 1;
    if (next_crouch != crouching) {
        float old_height = player_height();
        crouching = next_crouch;
        y += old_height - player_height();
    }
    float body_height = player_height();
    speed = 210 + distance * 0.008f;
    if (speed > 355) speed = 355;
    float travel = speed * dt;
    distance += travel;
    for (int i = 0; i < 4; ++i) {
        float incoming = 0;
        if (obstacles[i].kind == FLYER) {
            incoming = travel * 0.35f;
            // Preserve space behind the preceding hazard for a fair dodge.
            for (int j = 0; j < 4; ++j) {
                if (j != i && obstacles[j].x < obstacles[i].x
                    && obstacles[i].x - obstacles[j].x - obstacles[j].width < 190) incoming = 0;
            }
        }
        obstacles[i].x -= travel + incoming;
    }
    for (int i = 0; i < 4; ++i) {
        if (obstacles[i].x + obstacles[i].width < -30) {
            float farthest = 720;
            for (int j = 0; j < 4; ++j)
                if (obstacles[j].x + obstacles[j].width > farthest)
                    farthest = obstacles[j].x + obstacles[j].width;
            place(i, farthest + 260 + random_value() % 95);
        }
    }
    float previous_bottom = y + body_height;
    velocity += 1100 * dt;
    y += velocity * dt;
    if (jumps > 0) angle += (jumps == 1 ? 9 : 13) * dt;
    for (int i = 0; i < 4; ++i) {
        Obstacle *o = &obstacles[i];
        if (o->kind == FLYER || o->kind == OVERHANG) continue;
        float top = o->kind == GAP ? GROUND : GROUND - o->height;
        float left = PLAYER_X + 3;
        float right = PLAYER_X + SIZE - 3;
        float edge = o->x + o->width;
        int left_corner = right >= o->x && left < o->x && right - o->x <= 10;
        int right_corner = left <= edge && right > edge && edge - left <= 10;
        if (jumps > 0 && velocity > 0 && previous_bottom <= top + 1
            && y + body_height >= top && (left_corner || right_corner)) {
            y = top - SIZE;
            velocity = -780;
            launched = 1;
            state = 3;
            return;
        }
    }
    int over_gap = 0;
    for (int i = 0; i < 4; ++i) {
        Obstacle *o = &obstacles[i];
        if (o->kind == GAP && PLAYER_X + SIZE > o->x + 4 && PLAYER_X < o->x + o->width - 4) over_gap = 1;
    }
    if (!over_gap && previous_bottom <= GROUND + 1 && y + body_height >= GROUND && velocity >= 0) {
        y = GROUND - body_height;
        velocity = 0;
        jumps = 0;
        angle = 0;
    }
    for (int i = 0; i < 4; ++i) {
        Obstacle *o = &obstacles[i];
        if (o->kind == GAP) continue;
        float top = obstacle_top(o);
        float bottom = o->kind == FLYER ? top + 22 : o->kind == OVERHANG ? 201 : GROUND;
        if (PLAYER_X + SIZE - 3 > o->x && PLAYER_X + 3 < o->x + o->width
            && y + body_height - 2 > top && y + 2 < bottom) state = 2;
    }
    if (y > 280) state = 2;
}

EXPORT("runner_value")
float runner_value(int key) {
    switch (key) {
        case 0: return y;
        case 1: return velocity;
        case 2: return distance;
        case 3: return speed;
        case 4: return state;
        case 5: return jumps;
        case 6: return x;
        case 7: return angle;
        case 8: return launched;
        case 9: return launch_time;
        case 10: return crouching;
        default: return 0;
    }
}

EXPORT("runner_obstacle")
float runner_obstacle(int index, int key) {
    if (index < 0 || index >= 4) return 0;
    Obstacle *o = &obstacles[index];
    switch (key) {
        case 0: return o->x;
        case 1: return o->width;
        case 2: return o->height;
        case 3: return o->kind;
        case 4: return obstacle_top(o);
        default: return 0;
    }
}
