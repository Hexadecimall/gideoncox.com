var e = class e {
	static read_bytes(t, n) {
		let r = new e();
		return r.buf = t.getUint32(n, !0), r.buf_len = t.getUint32(n + 4, !0), r;
	}
	static read_bytes_array(t, n, r) {
		let i = [];
		for (let a = 0; a < r; a++) i.push(e.read_bytes(t, n + 8 * a));
		return i;
	}
}, t = class e {
	static read_bytes(t, n) {
		let r = new e();
		return r.buf = t.getUint32(n, !0), r.buf_len = t.getUint32(n + 4, !0), r;
	}
	static read_bytes_array(t, n, r) {
		let i = [];
		for (let a = 0; a < r; a++) i.push(e.read_bytes(t, n + 8 * a));
		return i;
	}
}, n = class {
	write_bytes(e, t) {
		e.setUint8(t, this.fs_filetype), e.setUint16(t + 2, this.fs_flags, !0), e.setBigUint64(t + 8, this.fs_rights_base, !0), e.setBigUint64(t + 16, this.fs_rights_inherited, !0);
	}
	constructor(e, t) {
		this.fs_rights_base = 0n, this.fs_rights_inherited = 0n, this.fs_filetype = e, this.fs_flags = t;
	}
}, r = class {
	write_bytes(e, t) {
		e.setBigUint64(t, this.dev, !0), e.setBigUint64(t + 8, this.ino, !0), e.setUint8(t + 16, this.filetype), e.setBigUint64(t + 24, this.nlink, !0), e.setBigUint64(t + 32, this.size, !0), e.setBigUint64(t + 38, this.atim, !0), e.setBigUint64(t + 46, this.mtim, !0), e.setBigUint64(t + 52, this.ctim, !0);
	}
	constructor(e, t, n) {
		this.dev = 0n, this.nlink = 0n, this.atim = 0n, this.mtim = 0n, this.ctim = 0n, this.ino = e, this.filetype = t, this.size = n;
	}
}, i = class e {
	static read_bytes(t, n) {
		return new e(t.getBigUint64(n, !0), t.getUint8(n + 8), t.getUint32(n + 16, !0), t.getBigUint64(n + 24, !0), t.getUint16(n + 36, !0));
	}
	constructor(e, t, n, r, i) {
		this.userdata = e, this.eventtype = t, this.clockid = n, this.timeout = r, this.flags = i;
	}
}, a = class {
	write_bytes(e, t) {
		e.setBigUint64(t, this.userdata, !0), e.setUint16(t + 8, this.error, !0), e.setUint8(t + 10, this.eventtype);
	}
	constructor(e, t, n) {
		this.userdata = e, this.error = t, this.eventtype = n;
	}
}, o = class {
	enable(e) {
		this.log = s(e === void 0 ? !0 : e, this.prefix);
	}
	get enabled() {
		return this.isEnabled;
	}
	constructor(e) {
		this.isEnabled = e, this.prefix = "wasi:", this.enable(e);
	}
};
function s(e, t) {
	return e ? console.log.bind(console, "%c%s", "color: #265BA0", t) : () => {};
}
new o(!1);
//#endregion
//#region node_modules/@bjorn3/browser_wasi_shim/dist/wasi.js
var c = class extends Error {
	constructor(e) {
		super("exit with exit code " + e), this.code = e;
	}
}, l = class e {
	static issue_ino() {
		return e.next_ino++;
	}
	static root_ino() {
		return 0n;
	}
	constructor() {
		this.ino = e.issue_ino();
	}
};
l.next_ino = 1n;
var u = class e {
	share_arrays_memory;
	constructor(e = new SharedArrayBuffer(10 * 1024 * 1024), t = !0) {
		if (this.share_arrays_memory = e, t) {
			let e = new Int32Array(this.share_arrays_memory);
			Atomics.store(e, 0, 0), Atomics.store(e, 1, 0), Atomics.store(e, 2, 12);
		}
	}
	static init_self(t) {
		return new e(t.share_arrays_memory, !1);
	}
	async async_write(e, t, n) {
		let r = new Int32Array(this.share_arrays_memory);
		for (;;) {
			let i, { value: a } = Atomics.waitAsync(r, 0, 1);
			if (i = a instanceof Promise ? await a : a, i === "timed-out") throw Error("timed-out lock");
			if (Atomics.compareExchange(r, 0, 0, 1) === 0) try {
				return this.write_inner(e, t, n);
			} finally {
				Atomics.store(r, 0, 0), Atomics.notify(r, 0, 1);
			}
		}
	}
	block_write(e, t, n) {
		for (;;) {
			let r = new Int32Array(this.share_arrays_memory);
			if (Atomics.wait(r, 0, 1) === "timed-out") throw Error("timed-out lock");
			if (Atomics.compareExchange(r, 0, 0, 1) === 0) try {
				return this.write_inner(e, t, n);
			} finally {
				Atomics.store(r, 0, 0), Atomics.notify(r, 0, 1);
			}
		}
	}
	write_inner(e, t, n) {
		let r = new Int32Array(this.share_arrays_memory), i = new Uint8Array(this.share_arrays_memory), a = Atomics.add(r, 1, 1), o;
		o = a === 0 ? Atomics.store(r, 2, 12) : Atomics.load(r, 2);
		let s = this.share_arrays_memory.byteLength, c = e.byteLength, l = o + c;
		if (s < l) throw Atomics.sub(r, 1, 1), Error("size is bigger than memory. \nTODO! fix memory limit. support big size another way.");
		let u;
		if (e instanceof Uint8Array) u = e;
		else if (e instanceof Uint32Array) {
			let t = new ArrayBuffer(e.byteLength);
			new Uint32Array(t).set(e), u = new Uint8Array(t);
		}
		i.set(new Uint8Array(u), o), Atomics.store(r, 2, l);
		let d = new Int32Array(t);
		return Atomics.store(d, n, o), Atomics.store(d, n + 1, c), [o, c];
	}
	free(e, t) {
		Atomics.sub(new Int32Array(this.share_arrays_memory), 1, 1);
	}
	get_memory(e, t) {
		let n = new ArrayBuffer(t);
		return new Uint8Array(n).set(new Uint8Array(this.share_arrays_memory).slice(e, e + t)), n;
	}
	take_memory(e, t) {
		if (!Number.isInteger(e) || !Number.isInteger(t) || e < 12 || t < 0 || e > this.share_arrays_memory.byteLength - t) throw RangeError("allocation is outside allocator data memory");
		try {
			return this.get_memory(e, t);
		} finally {
			this.free(e, t);
		}
	}
	use_defined_memory(e, t, n) {
		new Uint8Array(this.share_arrays_memory).set(new Uint8Array(n).slice(0, t), e);
	}
	get_object() {
		return { share_arrays_memory: this.share_arrays_memory };
	}
}, d = (e) => {
	let t = Error(e.message);
	return t.name = e.name, t.stack = e.stack?.replace(/.wasm:/g, ".wasm\n"), t.cause = e.cause, t;
}, f = 3, p = 2, m = 2 ** 30 - 2, h = function(e) {
	return e[e.Running = 0] = "Running", e[e.Destroying = 1] = "Destroying", e[e.Destroyed = 2] = "Destroyed", e[e.Failed = 3] = "Failed", e;
}({});
(function(e) {
	return e[e.None = 0] = "None", e[e.RequesterDrained = 1] = "RequesterDrained", e[e.Closing = 2] = "Closing", e;
})({});
var g = function(e) {
	return e[e.None = 0] = "None", e[e.CoordinatorBootstrap = 1] = "CoordinatorBootstrap", e[e.CoordinatorRuntime = 2] = "CoordinatorRuntime", e[e.WorkerBootstrap = 3] = "WorkerBootstrap", e[e.Protocol = 4] = "Protocol", e;
}({}), _ = class extends Error {
	code;
	constructor(e) {
		super(`worker destroy failed: ${g[e]}`), this.code = e, this.name = "WorkerDestroyError";
	}
};
function ee() {
	return new SharedArrayBuffer(16);
}
function v(e) {
	if (e === void 0) return 0;
	if (!Number.isInteger(e) || e < 0 || e > m) throw RangeError(`animal_id must be in 0..${m}`);
	return e + 1;
}
function te(e, t) {
	return v(t) << p | e;
}
function y(e) {
	return Atomics.load(e, 0) & f;
}
function ne(e) {
	let t = Atomics.load(e, 0) >>> p;
	return t === 0 ? void 0 : t - 1;
}
function b(e, t) {
	let n = te(1, t), r = Atomics.compareExchange(e, 0, 0, n) === 0;
	return r && x(e), r;
}
function x(e) {
	Atomics.add(e, 3, 1), Atomics.notify(e, 3);
}
function S(e, t) {
	for (;;) {
		let n = Atomics.load(e, 0), r = n & f;
		if (r === 2 || r === 3) return;
		if (r !== 1) throw new _(4);
		let i = n & -4 | t;
		if (Atomics.compareExchange(e, 0, n, i) === n) {
			x(e);
			return;
		}
	}
}
function C(e, t) {
	let n = y(e);
	if (!(n === 2 || n === 3)) {
		if (n === 0) throw new _(4);
		Atomics.compareExchange(e, 2, 0, t), S(e, 3);
	}
}
async function re(e, t) {
	let { value: n } = Atomics.waitAsync(e, 3, t);
	if ((n instanceof Promise ? await n : n) === "timed-out") throw Error("atomic wait timed out");
}
async function ie(e) {
	for (;;) {
		let t = y(e);
		if (t === 2) return;
		if (t === 3) throw new _(Atomics.load(e, 2));
		let n = Atomics.load(e, 3);
		y(e) === t && await re(e, n);
	}
}
async function w(e) {
	for (; Atomics.load(e, 1) === 0;) {
		let t = y(e);
		if (t === 3) throw new _(Atomics.load(e, 2));
		if (t === 2) return;
		let n = Atomics.load(e, 3);
		Atomics.load(e, 1) === 0 && y(e) === t && await re(e, n);
	}
}
function ae(e) {
	Atomics.store(e, 1, 2), x(e);
}
var oe = function(e) {
	return e[e.Pending = 0] = "Pending", e[e.Completing = 1] = "Completing", e[e.Ready = 2] = "Ready", e[e.Failed = 3] = "Failed", e[e.Cancelled = 4] = "Cancelled", e;
}({}), se = function(e) {
	return e[e.None = 0] = "None", e[e.Destroyed = 1] = "Destroyed", e[e.ScriptLoad = 2] = "ScriptLoad", e[e.AnimalConstruction = 3] = "AnimalConstruction", e[e.WasmInstantiation = 4] = "WasmInstantiation", e[e.Protocol = 5] = "Protocol", e;
}({}), T = function(e) {
	return e[e.Wait = 0] = "Wait", e[e.RequestTerminal = 1] = "RequestTerminal", e[e.LifecycleFailed = 2] = "LifecycleFailed", e[e.LifecycleDestroyed = 3] = "LifecycleDestroyed", e;
}({}), E = function(e) {
	return e[e.Waiting = 0] = "Waiting", e[e.Error = 1] = "Error", e[e.Exit = 2] = "Exit", e[e.Done = 3] = "Done", e[e.Cancelled = 4] = "Cancelled", e[e.Completing = 5] = "Completing", e[e.ErrorConsumed = 6] = "ErrorConsumed", e;
}({}), ce = 0;
function D(e, t, n) {
	if (!(e.buffer instanceof SharedArrayBuffer)) throw TypeError(`${n} must use SharedArrayBuffer`);
	if (e.byteLength !== t) throw RangeError(`${n} must be exactly ${t} bytes`);
}
function le(e) {
	return e === 2 || e === 3 || e === 4;
}
function ue(e, t) {
	return le(e) ? 1 : t === h.Failed ? 2 : t === h.Destroyed ? 3 : 0;
}
function de(e, t, n) {
	let r = y(t);
	n?.();
	let i = Atomics.load(e, 0);
	return {
		lifecycle: r,
		requestState: i,
		decision: ue(i, r)
	};
}
function fe(e, t, n) {
	if (!Number.isInteger(t) || t < 12) throw RangeError("worker request pointer must be in allocator data memory");
	if (!Number.isInteger(n) || n !== 12) throw RangeError("worker request length must be exactly 12");
	if (t % Int32Array.BYTES_PER_ELEMENT !== 0) throw RangeError("worker request pointer must be four-byte aligned");
	if (t > e.byteLength - n) throw RangeError("worker request is outside shared allocator memory");
	return new Int32Array(e, t, 12 / 4);
}
function pe(e) {
	return D(e, 12, "runtime completion view"), Atomics.compareExchange(e, ce, 0, 5) === 0;
}
function me(e, t) {
	return D(e, 12, "runtime completion view"), D(t, 16, "destroy status view"), Atomics.compareExchange(e, ce, 0, 4) === 0 ? (Atomics.notify(e, ce), x(t), !0) : !1;
}
function he(e, t, n) {
	if (D(e, 12, "runtime completion view"), D(n, 16, "destroy status view"), t !== 1 && t !== 2 && t !== 3 && t !== 4) throw RangeError("runtime completion state must be terminal");
	if (Atomics.compareExchange(e, ce, 5, t) !== 5) throw Error("runtime completion was not claimed");
	Atomics.notify(e, ce), x(n);
}
function ge(e, t, n, r, i) {
	if (D(e, 12, "worker request view"), D(i, 16, "destroy status view"), !le(t)) throw RangeError("worker request completion state must be terminal");
	return Atomics.compareExchange(e, 0, 0, 1) === 0 ? (Atomics.store(e, 1, n), Atomics.store(e, 2, r), Atomics.store(e, 0, t), Atomics.notify(e, 0), x(i), !0) : !1;
}
var O = function(e) {
	return e[e.Published = 0] = "Published", e[e.Idle = 1] = "Idle", e[e.Preparing = 2] = "Preparing", e[e.Claimed = 3] = "Claimed", e;
}({}), k = function(e) {
	return e[e.Free = 0] = "Free", e[e.Caller = 1] = "Caller", e[e.Reserved = 2] = "Reserved", e[e.CallerReserved = 3] = "CallerReserved", e[e.Coordinator = 4] = "Coordinator", e;
}({});
function _e(e) {
	for (;;) {
		let t = Atomics.load(e, 0);
		if (t !== 0 && t !== 1) return;
		let n = t === 0 ? 2 : 3;
		if (Atomics.compareExchange(e, 0, t, n) === t) {
			A(e), Atomics.notify(e, 0);
			return;
		}
	}
}
function ve(e) {
	Atomics.store(e, 0, 0), A(e), Atomics.notify(e, 0);
}
function A(e) {
	Atomics.add(e, 6, 1), Atomics.notify(e, 6);
}
var ye = (e) => {
	let t = new SharedArrayBuffer(28), n = new Int32Array(t);
	return Atomics.store(n, 1, 1), A(n), {
		allocator: { share_arrays_memory: new SharedArrayBuffer(10 * 1024) },
		lock: t,
		signature_input: new SharedArrayBuffer(32),
		destroy_status: e
	};
}, be = class e {
	allocator;
	lock;
	signature_input;
	destroy_status;
	constructor(e, t, n, r) {
		this.allocator = e, this.lock = t, this.signature_input = n, this.destroy_status = r;
	}
	block_lock_base_func(e = !0) {
		let t = new Int32Array(this.lock);
		for (;;) {
			let n = Atomics.compareExchange(t, 0, 0, 1);
			if (n === 0) {
				A(t), e && Atomics.store(t, 1, O.Preparing), A(t);
				return;
			}
			if (Atomics.wait(t, 0, n) === "timed-out") throw Error("timed-out lock");
		}
	}
	async async_lock_base_func(e = !0) {
		let t = new Int32Array(this.lock);
		for (;;) {
			let n = Atomics.compareExchange(t, 0, 0, 1);
			if (n === 0) {
				A(t), e && Atomics.store(t, 1, O.Preparing), A(t);
				return;
			}
			let { value: r } = Atomics.waitAsync(t, 0, n);
			if (await r === "timed-out") throw Error("timed-out lock");
		}
	}
	call_base_func() {
		let e = new Int32Array(this.lock);
		Atomics.store(e, 2, 1), Atomics.store(e, 1, O.Published), A(e);
	}
	block_wait_base_func() {
		let e = new Int32Array(this.lock);
		if (Atomics.wait(e, 2, 1) === "timed-out") throw Error("timed-out lock");
	}
	async async_wait_base_func() {
		let e = new Int32Array(this.lock), { value: t } = Atomics.waitAsync(e, 2, 1);
		if (await t === "timed-out") throw Error("timed-out lock");
	}
	release_base_func() {
		let e = new Int32Array(this.lock);
		for (Atomics.compareExchange(e, 1, O.Preparing, O.Idle) === O.Preparing && A(e);;) {
			let t = Atomics.load(e, 0);
			if (t !== k.Caller && t !== k.CallerReserved) throw Error("worker command caller does not own the termination gate");
			let n = t === k.CallerReserved ? k.Reserved : k.Free;
			if (Atomics.compareExchange(e, 0, t, n) === t) break;
		}
		A(e), Atomics.notify(e, 0);
	}
	encode_post_object(e) {
		let t = JSON.stringify(e === void 0 ? {} : e);
		if (t === void 0) throw TypeError("worker post data must be JSON serializable");
		return new TextEncoder().encode(t);
	}
	get_object() {
		return {
			allocator: this.allocator.get_object(),
			lock: this.lock,
			signature_input: this.signature_input,
			destroy_status: this.destroy_status
		};
	}
	notify_destroy() {
		A(new Int32Array(this.lock));
	}
	lifecycle_error(e) {
		return new _(y(e) === h.Failed ? Atomics.load(e, 2) : g.Protocol);
	}
	assert_running() {
		let e = new Int32Array(this.destroy_status);
		if (y(e) !== h.Running) throw this.lifecycle_error(e);
	}
	block_allocate(e) {
		let t = new SharedArrayBuffer(8), [n, r] = this.allocator.block_write(e, t, 0);
		return {
			ptr: n,
			len: r
		};
	}
	async async_allocate(e) {
		let t = new SharedArrayBuffer(8), [n, r] = await this.allocator.async_write(e, t, 0);
		return {
			ptr: n,
			len: r
		};
	}
	block_allocate_worker_request() {
		let e = this.block_allocate(new Uint8Array(15)), t = e.ptr + 3 & -4;
		return {
			allocationPtr: e.ptr,
			allocationLen: e.len,
			ptr: t,
			len: 12,
			view: new Int32Array(this.allocator.share_arrays_memory, t, 12 / 4)
		};
	}
	async async_allocate_worker_request() {
		let e = await this.async_allocate(new Uint8Array(15)), t = e.ptr + 3 & -4;
		return {
			allocationPtr: e.ptr,
			allocationLen: e.len,
			ptr: t,
			len: 12,
			view: new Int32Array(this.allocator.share_arrays_memory, t, 12 / 4)
		};
	}
	read_worker_request(e) {
		let t = Atomics.load(e, 0);
		if (t === oe.Ready) return new xe(Atomics.load(e, 2));
		if (t !== oe.Failed && t !== oe.Cancelled) throw Error(`worker request is not terminal: ${t}`);
		let n = Atomics.load(e, 1);
		throw Error(`worker request failed: ${se[n] ?? "Unknown"}`);
	}
	block_wait_worker_request(e) {
		let t = new Int32Array(this.destroy_status);
		for (;;) {
			let { lifecycle: n, requestState: r, decision: i } = de(e, t);
			if (i === T.RequestTerminal) return this.read_worker_request(e);
			if (i === T.LifecycleFailed) throw this.lifecycle_error(t);
			if (i === T.LifecycleDestroyed) throw new _(g.Protocol);
			let a = Atomics.load(t, 3);
			if (Atomics.load(e, 0) === r && y(t) === n && Atomics.load(t, 3) === a && Atomics.wait(t, 3, a) === "timed-out") throw Error("atomic wait timed out");
		}
	}
	async async_wait_worker_request(e) {
		let t = new Int32Array(this.destroy_status);
		for (;;) {
			let { lifecycle: n, requestState: r, decision: i } = de(e, t);
			if (i === T.RequestTerminal) return this.read_worker_request(e);
			if (i === T.LifecycleFailed) throw this.lifecycle_error(t);
			if (i === T.LifecycleDestroyed) throw new _(g.Protocol);
			let a = Atomics.load(t, 3);
			if (Atomics.load(e, 0) === r && y(t) === n && Atomics.load(t, 3) === a) {
				let { value: e } = Atomics.waitAsync(t, 3, a);
				if ((e instanceof Promise ? await e : e) === "timed-out") throw Error("atomic wait timed out");
			}
		}
	}
	new_worker(e, t, n) {
		return this.block_create_worker(e, t, n, 1);
	}
	block_create_worker(e, t, n, r) {
		this.assert_running();
		let i = this.encode_post_object(n), a, o, s, c = !1;
		try {
			this.block_lock_base_func();
			try {
				this.assert_running(), a = this.block_allocate_worker_request(), o = this.block_allocate(new TextEncoder().encode(e)), s = this.block_allocate(i);
				let n = new Int32Array(this.signature_input);
				Atomics.store(n, 0, r), Atomics.store(n, 1, o.ptr), Atomics.store(n, 2, o.len), Atomics.store(n, 3, +(t?.type === "module")), Atomics.store(n, 4, s.ptr), Atomics.store(n, 5, s.len), Atomics.store(n, 6, a.ptr), Atomics.store(n, 7, a.len), c = !0, this.call_base_func(), this.block_wait_base_func();
			} finally {
				this.release_base_func();
			}
			return this.block_wait_worker_request(a.view);
		} finally {
			c || (o !== void 0 && this.allocator.free(o.ptr, o.len), s !== void 0 && this.allocator.free(s.ptr, s.len)), a !== void 0 && this.allocator.free(a.allocationPtr, a.allocationLen);
		}
	}
	async async_start_on_thread(e, t, n) {
		this.assert_running();
		let r = this.encode_post_object(n), i, a, o, s = !1;
		try {
			await this.async_lock_base_func();
			try {
				this.assert_running(), i = await this.async_allocate_worker_request(), a = await this.async_allocate(new TextEncoder().encode(e)), o = await this.async_allocate(r);
				let n = new Int32Array(this.signature_input);
				Atomics.store(n, 0, 2), Atomics.store(n, 1, a.ptr), Atomics.store(n, 2, a.len), Atomics.store(n, 3, +(t?.type === "module")), Atomics.store(n, 4, o.ptr), Atomics.store(n, 5, o.len), Atomics.store(n, 6, i.ptr), Atomics.store(n, 7, i.len), s = !0, this.call_base_func(), await this.async_wait_base_func();
			} finally {
				this.release_base_func();
			}
			await this.async_wait_worker_request(i.view);
		} finally {
			s || (a !== void 0 && this.allocator.free(a.ptr, a.len), o !== void 0 && this.allocator.free(o.ptr, o.len)), i !== void 0 && this.allocator.free(i.allocationPtr, i.allocationLen);
		}
	}
	block_start_on_thread(e, t, n) {
		this.block_create_worker(e, t, n, 2);
	}
	static init_self(t) {
		return new e(u.init_self(t.allocator), t.lock, t.signature_input, t.destroy_status);
	}
	done_notify(e, t = !1) {
		t || this.block_lock_base_func(!1);
		try {
			let t = new Int32Array(this.lock, 12, 3);
			if (!pe(t)) {
				console.error("what happened?");
				return;
			}
			Atomics.store(t, 1, e), he(t, E.Exit, new Int32Array(this.destroy_status));
		} finally {
			t || this.release_base_func();
		}
	}
	cancel_runtime_completion() {
		return me(new Int32Array(this.lock, 12, 3), new Int32Array(this.destroy_status));
	}
	async async_wait_done_or_error() {
		let e = new Int32Array(this.lock, 12, 3), t = new Int32Array(this.destroy_status);
		for (;;) {
			let n = Atomics.load(t, 3), r = y(t), i = Atomics.load(e, 0);
			if (i !== E.Waiting && i !== E.Completing) {
				if (i !== E.Error) return this.read_runtime_completion(e, i);
				await this.async_lock_base_func(!1);
				try {
					return this.read_runtime_completion(e, Atomics.load(e, 0));
				} finally {
					this.release_base_func();
				}
			}
			if (r === h.Failed || r === h.Destroyed) throw this.lifecycle_error(t);
			let { value: a } = Atomics.waitAsync(t, 3, n);
			if ((a instanceof Promise ? await a : a) === "timed-out") throw Error("timed-out");
		}
	}
	block_wait_done_or_error() {
		let e = new Int32Array(this.lock, 12, 3), t = new Int32Array(this.destroy_status);
		for (;;) {
			let n = Atomics.load(t, 3), r = y(t), i = Atomics.load(e, 0);
			if (i !== E.Waiting && i !== E.Completing) {
				if (i !== E.Error) return this.read_runtime_completion(e, i);
				this.block_lock_base_func(!1);
				try {
					return this.read_runtime_completion(e, Atomics.load(e, 0));
				} finally {
					this.release_base_func();
				}
			}
			if (r === h.Failed || r === h.Destroyed) throw this.lifecycle_error(t);
			if (Atomics.wait(t, 3, n) === "timed-out") throw Error("timed-out");
		}
	}
	read_runtime_completion(e, t) {
		if (t === E.Done) return 0;
		if (t === E.Exit) return Atomics.load(e, 1);
		if (t === E.Cancelled) throw this.lifecycle_error(new Int32Array(this.destroy_status));
		if (t !== E.Error) throw t === E.ErrorConsumed ? Error("runtime error payload was already consumed") : Error(`unknown runtime completion state: ${t}`);
		if (Atomics.compareExchange(e, 0, E.Error, E.Completing) !== E.Error) return this.read_runtime_completion(e, Atomics.load(e, 0));
		try {
			let t = Atomics.load(e, 1), n = Atomics.load(e, 2), r = this.allocator.take_memory(t, n), i = new TextDecoder().decode(r);
			throw d(JSON.parse(i));
		} finally {
			Atomics.store(e, 0, E.ErrorConsumed), Atomics.notify(e, 0), x(new Int32Array(this.destroy_status));
		}
	}
	cancel_command_request(e) {
		let t = new Int32Array(this.signature_input), n = Atomics.load(t, 0);
		if (n !== 1 && n !== 2) return;
		let r;
		try {
			r = fe(this.allocator.share_arrays_memory, Atomics.load(t, 6), Atomics.load(t, 7));
		} catch (e) {
			console.error(e);
		}
		if (e) for (let [e, n] of [[1, 2], [4, 5]]) try {
			this.allocator.take_memory(Atomics.load(t, e), Atomics.load(t, n));
		} catch (e) {
			console.error(e);
		}
		r !== void 0 && ge(r, oe.Cancelled, se.Destroyed, 0, new Int32Array(this.destroy_status));
	}
	acknowledge_failed_command(e) {
		Atomics.store(e, 1, O.Idle), A(e), Atomics.store(e, 2, 0), Atomics.notify(e, 2, 1);
	}
	async recover_failed_coordinator_command() {
		let e = new Int32Array(this.lock);
		for (;;) {
			_e(e);
			let t = Atomics.load(e, 6), n = Atomics.load(e, 1), r = Atomics.load(e, 0);
			if (n === O.Idle && (r === k.Reserved || r === k.Coordinator)) {
				ve(e);
				return;
			}
			if (n === O.Published) {
				if (Atomics.compareExchange(e, 1, O.Published, O.Claimed) !== O.Published) continue;
				A(e);
				try {
					this.cancel_command_request(!0);
				} finally {
					this.acknowledge_failed_command(e);
				}
				continue;
			}
			if (n === O.Claimed) {
				try {
					this.cancel_command_request(!1);
				} finally {
					this.acknowledge_failed_command(e);
				}
				continue;
			}
			if (n !== O.Idle && n !== O.Preparing) throw Error(`unknown worker command state: ${n}`);
			if (Atomics.load(e, 1) !== n || Atomics.load(e, 0) !== r || Atomics.load(e, 6) !== t) continue;
			let { value: i } = Atomics.waitAsync(e, 6, t);
			if ((i instanceof Promise ? await i : i) === "timed-out") throw Error("timed-out");
		}
	}
	terminate_all_workers() {
		this.assert_running(), this.block_lock_base_func();
		try {
			this.assert_running();
			let e = new Int32Array(this.signature_input);
			Atomics.store(e, 0, 3), this.call_base_func(), this.block_wait_base_func();
		} finally {
			this.release_base_func();
		}
	}
	kill_animal(e) {
		this.assert_running(), this.block_lock_base_func();
		try {
			this.assert_running();
			let t = new Int32Array(this.signature_input);
			Atomics.store(t, 0, 4), Atomics.store(t, 1, e), this.call_base_func(), this.block_wait_base_func();
		} finally {
			this.release_base_func();
		}
	}
}, xe = class {
	id;
	constructor(e) {
		this.id = e;
	}
	get_id() {
		return this.id;
	}
}, Se = () => {
	let e = new Blob(["let worker_background;const ALLOCATOR_DATA_OFFSET=12;class AllocatorUseArrayBuffer{share_arrays_memory;constructor(e=new SharedArrayBuffer(0xa00000),r=!0){if(this.share_arrays_memory=e,r){const e=new Int32Array(this.share_arrays_memory);Atomics.store(e,0,0),Atomics.store(e,1,0),Atomics.store(e,2,12)}}static init_self(e){return new AllocatorUseArrayBuffer(e.share_arrays_memory,!1)}async async_write(e,r,t){let i=new Int32Array(this.share_arrays_memory);for(;;){let{value:o}=Atomics.waitAsync(i,0,1);if(\"timed-out\"===(o instanceof Promise?await o:o))throw Error(\"timed-out lock\");if(0===Atomics.compareExchange(i,0,0,1))try{return this.write_inner(e,r,t)}finally{Atomics.store(i,0,0),Atomics.notify(i,0,1)}}}block_write(e,r,t){for(;;){let i=new Int32Array(this.share_arrays_memory);if(\"timed-out\"===Atomics.wait(i,0,1))throw Error(\"timed-out lock\");if(0===Atomics.compareExchange(i,0,0,1))try{return this.write_inner(e,r,t)}finally{Atomics.store(i,0,0),Atomics.notify(i,0,1)}}}write_inner(e,r,t){let i,o,a=new Int32Array(this.share_arrays_memory),s=new Uint8Array(this.share_arrays_memory);i=0===Atomics.add(a,1,1)?Atomics.store(a,2,12):Atomics.load(a,2);let n=this.share_arrays_memory.byteLength,l=e.byteLength,c=i+l;if(n<c)throw Atomics.sub(a,1,1),Error(\"size is bigger than memory. \\nTODO! fix memory limit. support big size another way.\");if(e instanceof Uint8Array)o=e;else if(e instanceof Uint32Array){let r=new ArrayBuffer(e.byteLength);new Uint32Array(r).set(e),o=new Uint8Array(r)}s.set(new Uint8Array(o),i),Atomics.store(a,2,c);let d=new Int32Array(r);return Atomics.store(d,t,i),Atomics.store(d,t+1,l),[i,l]}free(e,r){Atomics.sub(new Int32Array(this.share_arrays_memory),1,1)}get_memory(e,r){let t=new ArrayBuffer(r);return new Uint8Array(t).set(new Uint8Array(this.share_arrays_memory).slice(e,e+r)),t}take_memory(e,r){if(!Number.isInteger(e)||!Number.isInteger(r)||e<12||r<0||e>this.share_arrays_memory.byteLength-r)throw RangeError(\"allocation is outside allocator data memory\");try{return this.get_memory(e,r)}finally{this.free(e,r)}}use_defined_memory(e,r,t){new Uint8Array(this.share_arrays_memory).set(new Uint8Array(t).slice(0,r),e)}get_object(){return{share_arrays_memory:this.share_arrays_memory}}}const serialize=e=>({message:e.message,name:e.name,stack:e.stack,cause:e.cause}),DESTROY_REQUESTER_STATUS=1,MAX_ANIMAL_ID=0x40000000-2;var WorkerLifecycle=function(e){return e[e.Running=0]=\"Running\",e[e.Destroying=1]=\"Destroying\",e[e.Destroyed=2]=\"Destroyed\",e[e.Failed=3]=\"Failed\",e}({}),RequesterStatus=function(e){return e[e.None=0]=\"None\",e[e.RequesterDrained=1]=\"RequesterDrained\",e[e.Closing=2]=\"Closing\",e}({}),WorkerDestroyFailureCode=function(e){return e[e.None=0]=\"None\",e[e.CoordinatorBootstrap=1]=\"CoordinatorBootstrap\",e[e.CoordinatorRuntime=2]=\"CoordinatorRuntime\",e[e.WorkerBootstrap=3]=\"WorkerBootstrap\",e[e.Protocol=4]=\"Protocol\",e}({});class WorkerDestroyError extends Error{code;constructor(e){super(\"worker destroy failed: \"+WorkerDestroyFailureCode[e]),this.code=e,this.name=\"WorkerDestroyError\"}}function requesterCode(e){if(void 0===e)return 0;if(!Number.isInteger(e)||e<0||e>MAX_ANIMAL_ID)throw RangeError(\"animal_id must be in 0..\"+MAX_ANIMAL_ID);return e+1}function encodeControl(e,r){return requesterCode(r)<<2|e}function readLifecycle(e){return 3&Atomics.load(e,0)}function readRequesterAnimalId(e){let r=Atomics.load(e,0)>>>2;return 0===r?void 0:r-1}function beginDestroy(e,r){let t=encodeControl(1,r),i=0===Atomics.compareExchange(e,0,0,t);return i&&wakeDestroyWaiters(e),i}function wakeDestroyWaiters(e){Atomics.add(e,3,1),Atomics.notify(e,3)}function finishDestroy(e,r){for(;;){let t=Atomics.load(e,0),i=3&t;if(2===i||3===i)return;if(1!==i)throw new WorkerDestroyError(4);let o=-4&t|r;if(Atomics.compareExchange(e,0,t,o)===t)return void wakeDestroyWaiters(e)}}function markDestroyed(e){finishDestroy(e,2)}function markDestroyFailed(e,r){let t=readLifecycle(e);if(2!==t&&3!==t){if(0===t)throw new WorkerDestroyError(4);Atomics.compareExchange(e,2,0,r),finishDestroy(e,3)}}function markRequesterClosing(e){Atomics.store(e,1,2),wakeDestroyWaiters(e)}var WorkerRequestState=function(e){return e[e.Pending=0]=\"Pending\",e[e.Completing=1]=\"Completing\",e[e.Ready=2]=\"Ready\",e[e.Failed=3]=\"Failed\",e[e.Cancelled=4]=\"Cancelled\",e}({}),WorkerRequestFailure=function(e){return e[e.None=0]=\"None\",e[e.Destroyed=1]=\"Destroyed\",e[e.ScriptLoad=2]=\"ScriptLoad\",e[e.AnimalConstruction=3]=\"AnimalConstruction\",e[e.WasmInstantiation=4]=\"WasmInstantiation\",e[e.Protocol=5]=\"Protocol\",e}({}),RuntimeCompletion=function(e){return e[e.Waiting=0]=\"Waiting\",e[e.Error=1]=\"Error\",e[e.Exit=2]=\"Exit\",e[e.Done=3]=\"Done\",e[e.Cancelled=4]=\"Cancelled\",e[e.Completing=5]=\"Completing\",e[e.ErrorConsumed=6]=\"ErrorConsumed\",e}({});function validateSharedView(e,r,t){if(!(e.buffer instanceof SharedArrayBuffer))throw TypeError(`${t} must use SharedArrayBuffer`);if(e.byteLength!==r)throw RangeError(`${t} must be exactly ${r} bytes`)}function isWorkerRequestTerminal(e){return 2===e||3===e||4===e}function createWorkerRequestView(e,r,t){if(!Number.isInteger(r)||r<12)throw RangeError(\"worker request pointer must be in allocator data memory\");if(!Number.isInteger(t)||12!==t)throw RangeError(\"worker request length must be exactly 12\");if(r%Int32Array.BYTES_PER_ELEMENT!=0)throw RangeError(\"worker request pointer must be four-byte aligned\");if(r>e.byteLength-t)throw RangeError(\"worker request is outside shared allocator memory\");return new Int32Array(e,r,3)}function claimRuntimeCompletion(e){return validateSharedView(e,12,\"runtime completion view\"),0===Atomics.compareExchange(e,0,0,5)}function finishRuntimeCompletion(e,r,t){if(validateSharedView(e,12,\"runtime completion view\"),validateSharedView(t,16,\"destroy status view\"),1!==r&&2!==r&&3!==r&&4!==r)throw RangeError(\"runtime completion state must be terminal\");if(5!==Atomics.compareExchange(e,0,5,r))throw Error(\"runtime completion was not claimed\");Atomics.notify(e,0),wakeDestroyWaiters(t)}function completeWorkerRequest(e,r,t,i,o){if(validateSharedView(e,12,\"worker request view\"),validateSharedView(o,16,\"destroy status view\"),!isWorkerRequestTerminal(r))throw RangeError(\"worker request completion state must be terminal\");return 0===Atomics.compareExchange(e,0,0,1)&&(Atomics.store(e,1,t),Atomics.store(e,2,i),Atomics.store(e,0,r),Atomics.notify(e,0),wakeDestroyWaiters(o),!0)}const SIGNATURE_REQUEST_STATUS_PTR=6,SIGNATURE_REQUEST_STATUS_LEN=7,WORKER_BACKGROUND_LOCK_BYTES=28;var WorkerCommandState=function(e){return e[e.Published=0]=\"Published\",e[e.Idle=1]=\"Idle\",e[e.Preparing=2]=\"Preparing\",e[e.Claimed=3]=\"Claimed\",e}({}),WorkerTerminationGate=function(e){return e[e.Free=0]=\"Free\",e[e.Caller=1]=\"Caller\",e[e.Reserved=2]=\"Reserved\",e[e.CallerReserved=3]=\"CallerReserved\",e[e.Coordinator=4]=\"Coordinator\",e}({});function reserveWorkerTermination(e){for(;;){let r=Atomics.load(e,0);if(0!==r&&1!==r)return;let t=0===r?2:3;if(Atomics.compareExchange(e,0,r,t)===r){wakeWorkerCommandActivity(e),Atomics.notify(e,0);return}}}function releaseWorkerTermination(e){Atomics.store(e,0,0),wakeWorkerCommandActivity(e),Atomics.notify(e,0)}function wakeWorkerCommandActivity(e){Atomics.add(e,6,1),Atomics.notify(e,6)}function asError(e){return e instanceof Error?e:Error(e+\"\")}class WorkerBackground{override_object;allocator;lock;signature_input;destroy_status;workers=[void 0];listen_holder;start_worker;start_worker_requested=!1;animal_workers=new Map;pending_animal_workers=new Map;worker_animals=new Map;next_animal_id=0;free_animal_ids=[];terminated_records=new WeakSet;pending_retirements=new Set;stopping_workers=!1;teardown_promise;teardown_failure;teardown_requester;schedule_timeout=setTimeout;cancel_timeout=clearTimeout;constructor(e,r,t,i,o){this.override_object=e,this.destroy_status=r,this.lock=t??new SharedArrayBuffer(28);const a=new Int32Array(this.lock);0===Atomics.load(a,1)&&0===Atomics.load(a,2)&&(Atomics.store(a,1,WorkerCommandState.Idle),wakeWorkerCommandActivity(a)),this.allocator=i??new AllocatorUseArrayBuffer(new SharedArrayBuffer(10240)),this.signature_input=o??new SharedArrayBuffer(32),this.listen_holder=this.listen()}static init_self(e,r){return new WorkerBackground(e,r.destroy_status,r.lock,AllocatorUseArrayBuffer.init_self(r.allocator),r.signature_input)}assign_worker_id(){for(let e=1;e<this.workers.length;e++)if(void 0===this.workers[e])return e;return this.workers.push(void 0),this.workers.length-1}allocate_animal_id(){let e=this.free_animal_ids.pop();if(void 0!==e)return e;if(this.next_animal_id>0x40000000-2)throw RangeError(\"no Animal IDs are available\");return this.next_animal_id++}release_animal_id(e){this.free_animal_ids.push(e)}ref(){return{allocator:this.allocator.get_object(),lock:this.lock,signature_input:this.signature_input,destroy_status:this.destroy_status}}terminate_worker(e){if(this.terminated_records.has(e))return;let r=e.worker;void 0!==r&&(this.terminated_records.add(e),this.detach_handlers(e),r.terminate())}retire_record(e){this.terminated_records.has(e)||(this.pending_retirements.add(e),reserveWorkerTermination(new Int32Array(this.lock)))}drain_retirements(){for(let e of this.pending_retirements)this.retire_record_inner(e);this.pending_retirements.clear(),this.stopping_workers=!1}retire_record_inner(e,r=!0){if(e.retired)return!1;e.retired=!0;let t=!1;return e.worker_id>0&&this.workers[e.worker_id]===e&&(this.workers[e.worker_id]=void 0,t=!0),0===e.worker_id&&this.start_worker===e&&(this.start_worker=void 0,t=!0),this.pending_animal_workers.get(e.animal_id)===e&&(this.pending_animal_workers.delete(e.animal_id),t=!0),this.animal_workers.get(e.animal_id)===e&&(this.animal_workers.delete(e.animal_id),t=!0),t&&this.worker_animals.get(e.worker_id)===e.animal_id&&this.worker_animals.delete(e.worker_id),!t||this.pending_animal_workers.has(e.animal_id)||this.animal_workers.has(e.animal_id)||this.release_animal_id(e.animal_id),r&&this.terminate_worker(e),t}is_active_record(e){return!e.retired&&!this.pending_retirements.has(e)&&(0===e.worker_id?this.start_worker===e:this.workers[e.worker_id]===e)}mark_inactive_requester_closing(e){return this.teardown_requester===e&&(markRequesterClosing(new Int32Array(this.destroy_status)),!0)}detach_handlers(e){let r=e.worker;void 0!==r&&(r.onmessage=null,r.onerror=null,r.onmessageerror=null)}terminate_registered_workers(){this.stopping_workers=!0;let e=new Set;for(let r of this.workers)void 0!==r&&e.add(r);for(let r of(void 0!==this.start_worker&&e.add(this.start_worker),this.pending_animal_workers.values()))e.add(r);for(let r of this.animal_workers.values())e.add(r);let r=new Int32Array(this.destroy_status);for(let t of e){let e=t.request_view;t.request_view=void 0,void 0!==e&&completeWorkerRequest(e,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,t.worker_id,r),this.retire_record(t)}reserveWorkerTermination(new Int32Array(this.lock))}cancel_runtime(){let e=new Int32Array(this.lock,12,3);claimRuntimeCompletion(e)&&finishRuntimeCompletion(e,RuntimeCompletion.Cancelled,new Int32Array(this.destroy_status))}teardown(){return this.teardown_promise??=Promise.resolve().then(()=>this.teardown_inner()),this.teardown_promise}fail_runtime(e,r=WorkerDestroyFailureCode.CoordinatorRuntime){this.teardown_failure??=r,beginDestroy(new Int32Array(this.destroy_status)),wakeWorkerCommandActivity(new Int32Array(this.lock))}record_teardown_error(e){this.teardown_failure??=WorkerDestroyFailureCode.CoordinatorRuntime,console.error(e)}async wait_for_requester_closing(e){let r,t=(async()=>{for(;;){let r=Atomics.load(e,1);if(r===RequesterStatus.Closing)return;let t=Atomics.load(e,3),i=Atomics.load(e,1);if(i===RequesterStatus.Closing)return;if(i!==r)continue;let{value:o}=Atomics.waitAsync(e,3,t);if(\"timed-out\"===(o instanceof Promise?await o:o))throw Error(\"atomic wait timed out\")}})(),i=new Promise(e=>{r=this.schedule_timeout(e,1e3)});await Promise.race([t,i]),void 0!==r&&this.cancel_timeout(r)}async teardown_inner(){let e=new Int32Array(this.lock),r=new Int32Array(this.destroy_status),t=readRequesterAnimalId(r),i=void 0===t?void 0:this.animal_workers.get(t)??this.pending_animal_workers.get(t),o=new Set;for(let e of this.pending_retirements)o.add(e);for(let e of this.workers)void 0!==e&&o.add(e);for(let e of(void 0!==this.start_worker&&o.add(this.start_worker),this.pending_animal_workers.values()))o.add(e);for(let e of this.animal_workers.values())o.add(e);for(let e of(this.teardown_requester=i,o)){let t=e.request_view;if(e.request_view=void 0,void 0!==t)try{completeWorkerRequest(t,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,e.worker_id,r)}catch(e){this.record_teardown_error(e)}try{this.retire_record_inner(e,e!==i)}catch(e){this.record_teardown_error(e)}}this.workers=[void 0],this.start_worker=void 0,this.animal_workers.clear(),this.pending_animal_workers.clear(),this.worker_animals.clear(),this.pending_retirements.clear();try{this.cancel_runtime()}catch(e){this.record_teardown_error(e)}if(releaseWorkerTermination(e),void 0!==i){Atomics.store(r,1,RequesterStatus.RequesterDrained),wakeDestroyWaiters(r);try{await this.wait_for_requester_closing(r)}catch(e){this.record_teardown_error(e)}for(;await this.claim_command(e,!0);)try{this.cancel_claimed_command(new Int32Array(this.signature_input))}finally{this.acknowledge_command(e)}try{this.terminate_worker(i)}catch(e){this.record_teardown_error(e)}finally{releaseWorkerTermination(e)}}this.teardown_requester=void 0;try{void 0===this.teardown_failure?markDestroyed(r):markDestroyFailed(r,this.teardown_failure)}catch(e){this.teardown_failure??=WorkerDestroyFailureCode.CoordinatorRuntime;try{readLifecycle(r)===WorkerLifecycle.Running&&beginDestroy(r),markDestroyFailed(r,this.teardown_failure)}catch(r){console.error(e,r)}}globalThis.close()}complete_request_ready(e,r){if(!this.is_active_record(e))return this.retire_record(e),!1;let t=e.request_view,i=new Int32Array(this.destroy_status),o=readLifecycle(i)===WorkerLifecycle.Running&&!this.stopping_workers,a=Number.isInteger(r)&&r===e.animal_id,s=void 0!==t&&Atomics.load(t,0)===WorkerRequestState.Pending&&this.pending_animal_workers.get(e.animal_id)===e;return a&&s?o?(this.pending_animal_workers.delete(e.animal_id),this.animal_workers.set(e.animal_id,e),this.worker_animals.set(e.worker_id,e.animal_id),e.request_view=void 0,!!completeWorkerRequest(t,WorkerRequestState.Ready,WorkerRequestFailure.None,e.worker_id,i)||(this.retire_record(e),!1)):(e.request_view=void 0,completeWorkerRequest(t,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,e.worker_id,i),this.retire_record(e),!1):(void 0!==t?this.complete_request_failure(e,WorkerRequestFailure.Protocol):this.retire_record(e),!1)}complete_request_failure(e,r){if(!this.is_active_record(e))return void this.retire_record(e);let t=e.request_view;e.request_view=void 0;try{void 0!==t&&completeWorkerRequest(t,WorkerRequestState.Failed,r,e.worker_id,new Int32Array(this.destroy_status))}finally{this.retire_record(e)}}publish_runtime_exit(e){let r=new Int32Array(this.lock,12,3);claimRuntimeCompletion(r)&&(Atomics.store(r,1,e),finishRuntimeCompletion(r,RuntimeCompletion.Exit,new Int32Array(this.destroy_status)))}publish_runtime_done(){let e=new Int32Array(this.lock,12,3);claimRuntimeCompletion(e)&&finishRuntimeCompletion(e,RuntimeCompletion.Done,new Int32Array(this.destroy_status))}publish_runtime_error(e){let r,t=new Int32Array(this.lock,12,3);try{let i=serialize(asError(e)),o=new TextEncoder().encode(JSON.stringify(i)),a=new Int32Array(this.allocator.share_arrays_memory);if(0!==Atomics.compareExchange(a,0,0,1))throw Error(\"runtime error allocator is busy\");try{r=this.allocator.write_inner(o,new SharedArrayBuffer(8),0)}finally{Atomics.store(a,0,0),Atomics.notify(a,0,1)}if(!claimRuntimeCompletion(t))return void this.allocator.free(r[0],r[1]);Atomics.store(t,1,r[0]),Atomics.store(t,2,r[1]),finishRuntimeCompletion(t,RuntimeCompletion.Error,new Int32Array(this.destroy_status))}catch(e){void 0!==r&&this.allocator.free(r[0],r[1]),this.fail_runtime(e)}}take_allocation(e,r){return this.allocator.take_memory(e,r)}read_command(e){let r,t,i,o,a,s=Atomics.load(e,6),n=Atomics.load(e,7);try{r=createWorkerRequestView(this.allocator.share_arrays_memory,s,n)}catch(e){t=e}try{i=this.take_allocation(Atomics.load(e,1),Atomics.load(e,2))}catch(e){a=e}try{o=this.take_allocation(Atomics.load(e,4),Atomics.load(e,5))}catch(e){a??=e}if(void 0!==t)throw t;if(void 0!==a)throw completeWorkerRequest(r,WorkerRequestState.Failed,WorkerRequestFailure.Protocol,0,new Int32Array(this.destroy_status)),a;let l=new TextDecoder().decode(i);try{return{obj:JSON.parse(new TextDecoder().decode(o)),requestView:r,url:l}}catch(e){throw completeWorkerRequest(r,WorkerRequestState.Failed,WorkerRequestFailure.Protocol,0,new Int32Array(this.destroy_status)),e}}cancel_claimed_command(e){let r,t=Atomics.load(e,0);if(1===t||2===t){try{r=createWorkerRequestView(this.allocator.share_arrays_memory,Atomics.load(e,6),Atomics.load(e,7))}catch(e){this.teardown_failure??=WorkerDestroyFailureCode.Protocol,console.error(e)}for(let[r,t]of[[1,2],[4,5]])try{this.take_allocation(Atomics.load(e,r),Atomics.load(e,t))}catch(e){this.teardown_failure??=WorkerDestroyFailureCode.Protocol,console.error(e)}if(void 0!==r)try{completeWorkerRequest(r,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,0,new Int32Array(this.destroy_status))}catch(e){this.record_teardown_error(e)}}}acknowledge_command(e){Atomics.store(e,1,WorkerCommandState.Idle),wakeWorkerCommandActivity(e),Atomics.store(e,2,0),Atomics.notify(e,2,1)}async claim_command(e,r=!1){for(;;){(r||this.pending_retirements.size>0||this.stopping_workers)&&reserveWorkerTermination(e);let t=Atomics.load(e,6),i=Atomics.load(e,1),o=Atomics.load(e,0);if(i===WorkerCommandState.Idle){if(o===WorkerTerminationGate.Coordinator)return!1;if(o===WorkerTerminationGate.Reserved&&Atomics.compareExchange(e,0,WorkerTerminationGate.Reserved,WorkerTerminationGate.Coordinator)===WorkerTerminationGate.Reserved)return wakeWorkerCommandActivity(e),!1;if(o===WorkerTerminationGate.Free&&!r)return!1}if(i===WorkerCommandState.Published){if(Atomics.compareExchange(e,1,WorkerCommandState.Published,WorkerCommandState.Claimed)===WorkerCommandState.Published)return wakeWorkerCommandActivity(e),!0;continue}if(i!==WorkerCommandState.Idle&&i!==WorkerCommandState.Preparing&&i!==WorkerCommandState.Claimed)throw Error(\"unknown worker command state: \"+i);if(Atomics.load(e,1)!==i||Atomics.load(e,0)!==o||Atomics.load(e,6)!==t)continue;let{value:a}=Atomics.waitAsync(e,6,t);if(\"timed-out\"===(a instanceof Promise?await a:a))throw Error(\"timed-out\")}}async finish_listen_teardown(e,r){for(;await this.claim_command(e,!0);)try{this.cancel_claimed_command(r)}finally{this.acknowledge_command(e)}await this.teardown()}register_handlers(e,r){let t=e.worker;void 0!==t&&(t.onmessage=t=>{let i=t.data;if(!this.is_active_record(e)){if(this.teardown_requester===e){let r=null!==i&&\"object\"==typeof i?i:void 0;return r?.msg===\"ready\"&&Number.isInteger(r.animal_id)&&r.animal_id===e.animal_id&&Atomics.load(new Int32Array(this.destroy_status),1)===RequesterStatus.RequesterDrained?void 0:r?.msg===\"ready\"?void this.mark_inactive_requester_closing(e):void((r?.msg===\"error\"||r?.msg===\"exit\")&&Number.isInteger(r.animal_id)&&r.animal_id===e.animal_id&&this.mark_inactive_requester_closing(e))}return void this.retire_record(e)}if(null===i||\"object\"!=typeof i){void 0!==e.request_view&&this.complete_request_failure(e,WorkerRequestFailure.Protocol),this.fail_runtime(Error(\"invalid worker message\"));return}if((\"ready\"===i.msg||\"done\"===i.msg||\"error\"===i.msg||\"exit\"===i.msg)&&(!Number.isInteger(i.animal_id)||i.animal_id!==e.animal_id))return void(void 0!==e.request_view?this.complete_request_failure(e,WorkerRequestFailure.Protocol):this.retire_record(e));if(\"ready\"===i.msg)return void this.complete_request_ready(e,i.animal_id);if(\"done\"===i.msg){void 0!==e.request_view?this.complete_request_failure(e,WorkerRequestFailure.Protocol):this.retire_record(e),r&&(this.terminate_registered_workers(),this.publish_runtime_done());return}if(\"error\"===i.msg||\"exit\"===i.msg){if(void 0!==e.request_view){let r=\"error\"===i.msg&&\"animal-construction\"===i.stage?WorkerRequestFailure.AnimalConstruction:\"error\"===i.msg&&\"wasm-instantiation\"===i.stage?WorkerRequestFailure.WasmInstantiation:WorkerRequestFailure.Protocol;this.complete_request_failure(e,r);return}this.terminate_registered_workers(),\"error\"===i.msg?this.publish_runtime_error(i.error??Error(\"worker error\")):this.publish_runtime_exit(i.code??1);return}void 0!==e.request_view&&this.complete_request_failure(e,WorkerRequestFailure.Protocol),this.fail_runtime(Error(\"unknown worker message\"))},t.onerror=r=>{if(r.preventDefault(),!this.is_active_record(e)){if(this.mark_inactive_requester_closing(e))return;this.retire_record(e);return}void 0!==e.request_view&&this.complete_request_failure(e,WorkerRequestFailure.ScriptLoad),this.fail_runtime(Error(r.message))},t.onmessageerror=()=>{if(!this.is_active_record(e)){if(this.mark_inactive_requester_closing(e))return;this.retire_record(e);return}void 0!==e.request_view&&this.complete_request_failure(e,WorkerRequestFailure.Protocol),this.fail_runtime(Error(\"worker message could not be decoded\"))})}create_worker(e){let r,t,i;try{r=this.read_command(e)}catch(e){this.fail_runtime(e);return}if(this.stopping_workers||readLifecycle(new Int32Array(this.destroy_status))!==WorkerLifecycle.Running)return void completeWorkerRequest(r.requestView,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,0,new Int32Array(this.destroy_status));try{t=this.allocate_animal_id()}catch(e){completeWorkerRequest(r.requestView,WorkerRequestState.Failed,WorkerRequestFailure.AnimalConstruction,0,new Int32Array(this.destroy_status)),this.fail_runtime(e);return}let o=this.assign_worker_id(),a={animal_id:t,request_view:r.requestView,retired:!1,worker_id:o};this.workers[o]=a,this.pending_animal_workers.set(t,a),this.worker_animals.set(o,t);try{i=new Worker(r.url,{type:1===Atomics.load(e,3)?\"module\":\"classic\"})}catch(e){this.complete_request_failure(a,WorkerRequestFailure.ScriptLoad),this.fail_runtime(e);return}a.worker=i,this.register_handlers(a,!1);try{i.postMessage({...this.override_object,...r.obj,animal_id:t,worker_id:o,worker_background_ref:this.ref()})}catch(e){this.complete_request_failure(a,WorkerRequestFailure.AnimalConstruction),this.fail_runtime(e)}}create_start_worker(e){let r,t,i;try{r=this.read_command(e)}catch(e){this.fail_runtime(e);return}if(this.stopping_workers||readLifecycle(new Int32Array(this.destroy_status))!==WorkerLifecycle.Running)return void completeWorkerRequest(r.requestView,WorkerRequestState.Cancelled,WorkerRequestFailure.Destroyed,0,new Int32Array(this.destroy_status));if(this.start_worker_requested)return void completeWorkerRequest(r.requestView,WorkerRequestState.Failed,WorkerRequestFailure.Protocol,0,new Int32Array(this.destroy_status));this.start_worker_requested=!0;try{t=this.allocate_animal_id()}catch(e){completeWorkerRequest(r.requestView,WorkerRequestState.Failed,WorkerRequestFailure.AnimalConstruction,0,new Int32Array(this.destroy_status)),this.fail_runtime(e);return}let o={animal_id:t,request_view:r.requestView,retired:!1,worker_id:0};this.start_worker=o,this.pending_animal_workers.set(t,o),this.worker_animals.set(0,t);try{i=new Worker(r.url,{type:1===Atomics.load(e,3)?\"module\":\"classic\"})}catch(e){this.complete_request_failure(o,WorkerRequestFailure.ScriptLoad),this.fail_runtime(e);return}o.worker=i,this.register_handlers(o,!0);try{i.postMessage({...this.override_object,...r.obj,animal_id:t,worker_background_ref:this.ref()})}catch(e){this.complete_request_failure(o,WorkerRequestFailure.WasmInstantiation),this.fail_runtime(e);return}}kill_animal(e){if(readLifecycle(new Int32Array(this.destroy_status))!==WorkerLifecycle.Running)return;let r=this.animal_workers.get(e);void 0!==r&&(r===this.start_worker&&this.cancel_runtime(),this.retire_record(r))}process_claimed_command(e){switch(Atomics.load(e,0)){case 1:this.create_worker(e);break;case 2:this.create_start_worker(e);break;case 3:this.terminate_registered_workers();break;case 4:{let r=Atomics.load(e,1);this.kill_animal(r);break}default:this.fail_runtime(Error(\"unknown worker background command\"),WorkerDestroyFailureCode.Protocol)}}async listen(){let e=new Int32Array(this.lock),r=new Int32Array(this.signature_input),t=new Int32Array(this.destroy_status);for(;;){if(readLifecycle(t)!==WorkerLifecycle.Running)return void await this.finish_listen_teardown(e,r);if(Atomics.load(e,0)===WorkerTerminationGate.Coordinator){try{this.drain_retirements()}catch(e){this.fail_runtime(e)}finally{releaseWorkerTermination(e)}continue}let i=Atomics.load(e,1),o=Atomics.load(e,0);if(i===WorkerCommandState.Idle&&0===o){let r=Atomics.load(e,6);if(Atomics.load(e,1)!==i||Atomics.load(e,0)!==o||readLifecycle(t)!==WorkerLifecycle.Running||Atomics.load(e,6)!==r)continue;let{value:a}=Atomics.waitAsync(e,6,r);if(\"timed-out\"===(a instanceof Promise?await a:a))throw Error(\"timed-out\");continue}if(await this.claim_command(e)){if(readLifecycle(t)!==WorkerLifecycle.Running){try{this.cancel_claimed_command(r)}finally{this.acknowledge_command(e)}continue}try{this.process_claimed_command(r)}catch(e){this.fail_runtime(e)}finally{this.acknowledge_command(e)}}}}}globalThis.onmessage=e=>{globalThis.onmessage=()=>void 0;let{override_object:r,worker_background_ref_object:t}=e.data;worker_background=WorkerBackground.init_self(r,t),postMessage(\"ready\")};"], { type: "application/javascript" });
	return URL.createObjectURL(e);
}, Ce = class e {
	sender;
	destroy_status;
	requester_animal_id;
	requester_shutdown;
	constructor(e, t, n) {
		this.sender = e, this.destroy_status = t, this.requester_animal_id = n;
	}
	static init_self(t) {
		return new e(be.init_self(t.sender), t.destroy_status);
	}
	static init_bound(t, n) {
		return new e(be.init_self(t.sender), t.destroy_status, n);
	}
	get_object() {
		return {
			sender: this.sender.get_object(),
			destroy_status: this.destroy_status
		};
	}
	destroy() {
		let e = new Int32Array(this.destroy_status);
		b(e, this.requester_animal_id) && (this.sender.notify_destroy(), this.requester_animal_id !== void 0 && this.schedule_requester_shutdown(e).catch(() => void 0));
	}
	async async_destroy() {
		let e = new Int32Array(this.destroy_status);
		if (b(e, this.requester_animal_id) && this.sender.notify_destroy(), this.requester_animal_id !== void 0 && ne(e) === this.requester_animal_id) {
			await this.schedule_requester_shutdown(e);
			return;
		}
		await ie(e);
	}
	schedule_requester_shutdown(e) {
		return this.requester_shutdown ??= (async () => {
			await w(e), setTimeout(() => {
				ae(e);
				try {
					let e = Reflect.get(globalThis, "close");
					typeof e == "function" && e.call(globalThis);
				} catch (e) {
					console.error("requester self-close failed", e);
				}
			}, 0);
		})(), this.requester_shutdown;
	}
}, we = class {
	unknown_fn;
	fds;
	stdin;
	stdout;
	stderr;
	default_allow_fds;
	constructor(e, t, n, r, i, a) {
		this.unknown_fn = a, this.fds = e, this.stdin = t, this.stdout = n, this.stderr = r, this.default_allow_fds = i, this.fds_map = Array(e.length);
		for (let t = 0; t < e.length; t++) this.fds_map[t] = [];
	}
	get_new_fd_lock = [];
	fds_map;
	async get_new_fd() {
		return new Promise((e) => {
			this.get_new_fd_lock.push(async () => {
				let t = -1;
				for (let e = 0; e < this.fds.length; e++) if (this.fds[e] === void 0) {
					t = e;
					break;
				}
				t === -1 && (t = this.fds.length, this.fds.push(void 0), this.fds_map.push([]));
				let [n, r] = this.can_set_new_fd(t);
				n || await r, e([async () => {
					this.get_new_fd_lock.shift();
					let e = this.get_new_fd_lock[0];
					e !== void 0 && e(), await this.notify_set_fd(t);
				}, t]);
			}) === 1 && this.get_new_fd_lock[0]();
		});
	}
	fd_advise(e) {
		return this.fds[e] === void 0 ? 8 : 0;
	}
	fd_allocate(e, t, n) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_allocate(t, n);
	}
	async fd_close(e) {
		if (this.fds[e] !== void 0) {
			let t = this.fds[e].fd_close();
			return this.fds[e] = void 0, await this.notify_rm_fd(e), t;
		}
		return 8;
	}
	fd_datasync(e) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_sync();
	}
	fd_fdstat_get(e) {
		if (this.fds[e] !== void 0) {
			let { ret: t, fdstat: n } = this.fds[e].fd_fdstat_get();
			return n == null ? [void 0, t] : [n, t];
		}
		return [void 0, 8];
	}
	fd_fdstat_set_flags(e, t) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_fdstat_set_flags(t);
	}
	fd_fdstat_set_rights(e, t, n) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_fdstat_set_rights(t, n);
	}
	fd_filestat_get(e) {
		if (this.fds[e] !== void 0) {
			let { ret: t, filestat: n } = this.fds[e].fd_filestat_get();
			return n == null ? [void 0, t] : [n, t];
		}
		return [void 0, 8];
	}
	fd_filestat_set_size(e, t) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_filestat_set_size(t);
	}
	fd_filestat_set_times(e, t, n, r) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_filestat_set_times(t, n, r);
	}
	fd_pread(e, t, n) {
		if (this.fds[e] !== void 0) {
			let r = 0, i = new Uint8Array();
			for (let a of t) {
				let { ret: t, data: o } = this.fds[e].fd_pread(a.buf_len, n);
				if (t !== 0) return [[r, i], t];
				let s = new Uint8Array(i.byteLength + o.byteLength);
				if (s.set(i), s.set(o, i.byteLength), i = s, r += o.byteLength, o.byteLength !== a.buf_len) break;
			}
			return [[r, i], 0];
		}
		return [void 0, 8];
	}
	fd_prestat_get(e) {
		if (this.fds[e] !== void 0) {
			let { ret: t, prestat: n } = this.fds[e].fd_prestat_get();
			return n == null ? [void 0, t] : [n, t];
		}
		return [void 0, 8];
	}
	fd_prestat_dir_name(e, t) {
		if (this.fds[e] !== void 0) {
			let { ret: n, prestat: r } = this.fds[e].fd_prestat_get();
			if (r) {
				let e = r.inner.pr_name;
				return e.length <= t ? [e, n] : [e.slice(0, t), 37];
			}
			return [void 0, n];
		}
		return [void 0, 8];
	}
	fd_pwrite(e, t, n) {
		if (this.fds[e] !== void 0) {
			let { ret: r, nwritten: i } = this.fds[e].fd_pwrite(t, n);
			return [i, r];
		}
		return [void 0, 8];
	}
	fd_read(e, t) {
		if (this.fds[e] !== void 0) {
			let n = 0, r = new Uint8Array();
			for (let i of t) {
				let { ret: t, data: a } = this.fds[e].fd_read(i.buf_len);
				if (t !== 0) return [[n, r], t];
				let o = new Uint8Array(r.byteLength + a.byteLength);
				if (o.set(r), o.set(a, r.byteLength), r = o, n += a.byteLength, a.byteLength !== i.buf_len) break;
			}
			return [[n, r], 0];
		}
		return [void 0, 8];
	}
	fd_readdir(e, t, n) {
		if (this.fds[e] !== void 0) {
			let r = new Uint8Array(t), i = 0, a = 0;
			for (;;) {
				let { ret: o, dirent: s } = this.fds[e].fd_readdir_single(n);
				if (o !== 0) return [[r, i], o];
				if (s == null) break;
				if (t - i < s.head_length()) {
					i = t;
					break;
				}
				let c = new ArrayBuffer(s.head_length());
				if (s.write_head_bytes(new DataView(c), 0), r.set(new Uint8Array(c).slice(0, Math.min(c.byteLength, t - i)), a), a += c.byteLength, i += c.byteLength, t - i < s.name_length()) {
					i = t;
					break;
				}
				s.write_name_bytes(r, a, t - i), a += s.name_length(), i += s.name_length(), n = s.d_next;
			}
			return [[r, i], 0];
		}
		return [void 0, 8];
	}
	fd_seek(e, t, n) {
		if (this.fds[e] !== void 0) {
			let { ret: r, offset: i } = this.fds[e].fd_seek(t, n);
			return [i, r];
		}
		return [void 0, 8];
	}
	fd_sync(e) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].fd_sync();
	}
	fd_tell(e) {
		if (this.fds[e] !== void 0) {
			let { ret: t, offset: n } = this.fds[e].fd_tell();
			return [n, t];
		}
		return [void 0, 8];
	}
	async fd_write(e, t) {
		if (this.fds[e] !== void 0) {
			let n = this.fds[e].fd_write(t), r, i;
			return n instanceof Promise ? {ret: r, nwritten: i} = await n : {ret: r, nwritten: i} = n, [i, r];
		}
		return [void 0, 8];
	}
	path_create_directory(e, t) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].path_create_directory(t);
	}
	path_filestat_get(e, t, n) {
		if (this.fds[e] !== void 0) {
			let { ret: r, filestat: i } = this.fds[e].path_filestat_get(t, n);
			return i == null ? [void 0, r] : [i, r];
		}
		return [void 0, 8];
	}
	path_filestat_set_times(e, t, n, r, i, a) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].path_filestat_set_times(t, n, r, i, a);
	}
	path_link(e, t, n, r, i) {
		if (this.fds[e] !== void 0 && this.fds[r] !== void 0) {
			let { ret: a, inode_obj: o } = this.fds[e].path_lookup(n, t);
			return o == null ? a : this.fds[r].path_link(i, o, !1);
		}
		return 8;
	}
	async path_open(e, t, n, r, i, a, o) {
		if (this.fds[e] !== void 0) {
			let { ret: s, fd_obj: c } = this.fds[e].path_open(t, n, r, i, a, o);
			if (s !== 0) return [void 0, s];
			let [l, u] = await this.get_new_fd();
			if (!c) throw "fd_obj should not be null";
			return this.fds[u] = c, await l(), [u, 0];
		}
		return [void 0, 8];
	}
	path_readlink(e, t, n) {
		if (this.fds[e] !== void 0) {
			let { ret: r, data: i } = this.fds[e].path_readlink(t);
			if (i != null) {
				let e = new TextEncoder().encode(i);
				return e.byteLength > n ? [e.slice(0, n), 61] : [e, r];
			}
			return [void 0, r];
		}
		return [void 0, 8];
	}
	path_remove_directory(e, t) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].path_remove_directory(t);
	}
	path_rename(e, t, n, r) {
		if (this.fds[e] !== void 0 && this.fds[n] !== void 0) {
			let { ret: i, inode_obj: a } = this.fds[e].path_unlink(t);
			if (a == null) return i;
			if (i = this.fds[n].path_link(r, a, !0), i !== 0 && this.fds[e].path_link(t, a, !0) !== 0) throw "path_link should always return success when relinking an inode back to the original place";
			return i;
		}
		return 8;
	}
	path_symlink(e, t, n) {
		return this.fds[t] === void 0 ? 8 : 58;
	}
	path_unlink_file(e, t) {
		return this.fds[e] === void 0 ? 8 : this.fds[e].path_unlink_file(t);
	}
}, Te = class {
	share_arrays_memory;
	data_size;
	constructor(e, t = 100 * 1024, n, r = !0) {
		if (this.data_size = e, n ? this.share_arrays_memory = n : this.share_arrays_memory = new SharedArrayBuffer(t), r) {
			let e = new Int32Array(this.share_arrays_memory);
			Atomics.store(e, 0, 0), Atomics.store(e, 1, 0), Atomics.store(e, 2, 12);
		}
	}
	static init_self_inner(e) {
		return {
			data_size: e.data_size,
			max_share_arrays_memory: e.share_arrays_memory.byteLength,
			share_arrays_memory: e.share_arrays_memory
		};
	}
	async async_lock() {
		let e = new Int32Array(this.share_arrays_memory);
		for (;;) {
			let t, { value: n } = Atomics.waitAsync(e, 0, 1);
			if (t = n instanceof Promise ? await n : n, t === "timed-out") throw Error("timed-out lock");
			if (Atomics.compareExchange(e, 0, 0, 1) === 0) break;
		}
	}
	block_lock() {
		for (;;) {
			let e = new Int32Array(this.share_arrays_memory);
			if (Atomics.wait(e, 0, 1) === "timed-out") throw Error("timed-out lock");
			if (Atomics.compareExchange(e, 0, 0, 1) === 0) break;
		}
	}
	release_lock() {
		let e = new Int32Array(this.share_arrays_memory);
		Atomics.store(e, 0, 0), Atomics.notify(e, 0, 1);
	}
	async async_send(e, t) {
		await this.async_lock();
		try {
			let n = new Int32Array(this.share_arrays_memory), r = Atomics.load(n, 2), i = t.byteLength;
			if (i !== this.data_size) throw Error(`invalid data size: ${i} !== ${this.data_size}`);
			let a = r + i + 8 + e.length * 4;
			if (a > this.share_arrays_memory.byteLength) throw Error("over memory");
			Atomics.store(n, 2, a);
			let o = new Int32Array(this.share_arrays_memory, r);
			o[0] = e.length, o[1] = e.length, o.set(e, 2), new Uint32Array(this.share_arrays_memory, r + 8 + e.length * 4).set(t), Atomics.add(n, 1, 1);
		} finally {
			this.release_lock();
		}
	}
	get_data(e) {
		let t = new Int32Array(this.share_arrays_memory);
		if (Atomics.load(t, 1) !== 0) {
			this.block_lock();
			try {
				let n = Atomics.load(t, 1), r = [], i = 12;
				for (let a = 0; a < n; a++) {
					let n = new Int32Array(this.share_arrays_memory, i), a = n[1], o = new Int32Array(this.share_arrays_memory, i + 8, a), s = this.data_size;
					if (o.includes(e)) {
						let c = new Uint32Array(this.share_arrays_memory, i + 8 + a * 4, s / 4);
						r.push(new Uint32Array([...c]));
						let l = o.indexOf(e);
						if (Atomics.store(o, l, -1), Atomics.sub(n, 0, 1) === 1) {
							Atomics.sub(t, 1, 1);
							let e = Atomics.load(t, 2) - s - 8 - a * 4;
							Atomics.store(t, 2, e);
							let n = i + s + 8 + a * 4, r = new Int32Array(this.share_arrays_memory, n);
							new Int32Array(this.share_arrays_memory, i).set(r);
						} else i += s + 8 + a * 4;
					} else i += s + 8 + a * 4;
				}
				if (i !== Atomics.load(t, 2)) throw Error(`invalid offset: ${i} !== ${Atomics.load(t, 2)}`);
				return r;
			} finally {
				this.release_lock();
			}
		}
	}
	get_object() {
		return {
			data_size: this.data_size,
			share_arrays_memory: this.share_arrays_memory
		};
	}
}, Ee = class e extends Te {
	constructor(e, t, n = !0) {
		super(4, e, t, n);
	}
	async send(e, t) {
		if (e === void 0 || e.length === 0) throw Error("targets is empty");
		await this.async_send(e, new Uint32Array([t]));
	}
	get(e) {
		let t = this.get_data(e);
		if (t === void 0) return;
		let n = [];
		for (let e of t) n.push(e[0]);
		return n;
	}
	get_object() {
		return super.get_object();
	}
	static init_self(t) {
		let n = Te.init_self_inner(t);
		return new e(n.max_share_arrays_memory, n.share_arrays_memory, !1);
	}
};
//#endregion
//#region src/shared_array_buffer/util.ts
function De(e) {
	let t = () => {
		throw Error("terminate called before async function started");
	};
	return {
		promise: new Promise((n, r) => {
			t = () => r(), e().then((e) => {
				n(e);
			});
		}),
		terminate: t
	};
}
//#endregion
//#region src/codec/ByteWriter.ts
var Oe = class {
	buf;
	view;
	offset = 0;
	constructor(e = 1024) {
		this.buf = new Uint8Array(e), this.view = new DataView(this.buf.buffer);
	}
	ensure(e) {
		let t = this.offset + e;
		if (t <= this.buf.length) return;
		let n = this.buf.length * 2;
		for (; n < t;) n *= 2;
		let r = new Uint8Array(n);
		r.set(this.buf), this.buf = r, this.view = new DataView(this.buf.buffer);
	}
	u8(e) {
		this.ensure(1), this.buf[this.offset++] = e & 255;
	}
	bytes(e) {
		this.ensure(e.length), this.buf.set(e, this.offset), this.offset += e.length;
	}
	i32(e) {
		this.ensure(4), this.view.setInt32(this.offset, e, !0), this.offset += 4;
	}
	f64(e) {
		this.ensure(8), this.view.setFloat64(this.offset, e, !0), this.offset += 8;
	}
	varuint(e) {
		if (!Number.isSafeInteger(e) || e < 0) throw RangeError("Invalid varuint");
		for (; e >= 128;) this.u8(e & 127 | 128), e = Math.floor(e / 128);
		this.u8(e);
	}
	finish() {
		return this.buf.subarray(0, this.offset);
	}
}, ke = class {
	buf;
	view;
	offset = 0;
	constructor(e) {
		this.buf = e, this.view = new DataView(e.buffer, e.byteOffset, e.byteLength);
	}
	ensure(e) {
		if (this.offset + e > this.buf.length) throw RangeError("Unexpected end of input");
	}
	u8() {
		return this.ensure(1), this.buf[this.offset++];
	}
	bytes(e) {
		this.ensure(e);
		let t = this.buf.subarray(this.offset, this.offset + e);
		return this.offset += e, t;
	}
	i32() {
		this.ensure(4);
		let e = this.view.getInt32(this.offset, !0);
		return this.offset += 4, e;
	}
	f64() {
		this.ensure(8);
		let e = this.view.getFloat64(this.offset, !0);
		if (this.offset += 8, !Number.isFinite(e)) throw TypeError(`Invalid encoded number: ${e}`);
		return e;
	}
	varuint() {
		let e = 0, t = 0;
		for (let n = 0; n < 10; n++) {
			let n = this.u8();
			if (e += (n & 127) * 2 ** t, !(n & 128)) {
				if (!Number.isSafeInteger(e)) throw RangeError("varuint exceeds safe integer range");
				return e;
			}
			t += 7;
		}
		throw RangeError("varuint is too long");
	}
	done() {
		return this.offset === this.buf.length;
	}
}, Ae = new TextEncoder(), je = 1e3;
function Me(e) {
	let t = new Oe();
	return Re(e, t, {
		seen: /* @__PURE__ */ new WeakSet(),
		depth: 0
	}), t.finish();
}
function Ne(e) {
	let t = Object.getPrototypeOf(e);
	return t === Object.prototype || t === null;
}
function Pe(e) {
	if (e.length < 32) return null;
	let t = !0, n = !0, r = !0;
	for (let i = 0; i < e.length; i++) {
		let a = e[i];
		if (typeof a != "number") {
			t = !1;
			break;
		}
		if (!Number.isFinite(a)) throw TypeError(`Invalid number in array at index ${i}: ${a}`);
		(!Number.isInteger(a) || a < 0 || a > 255) && (n = !1), (!Number.isInteger(a) || a < -2147483648 || a > 2147483647) && (r = !1);
	}
	return t ? n ? "u8" : r ? "i32" : "f64" : null;
}
function Fe(e, t) {
	let n = Ae.encode(e);
	t.u8(4), t.varuint(n.length), t.bytes(n);
}
function Ie(e, t, n) {
	for (let t = 0; t < e.length; t++) if (!(t in e)) throw TypeError(`Sparse array is not supported at index ${t}`);
	let r = Pe(e);
	if (r === "u8") {
		t.u8(7), t.varuint(e.length);
		for (let n = 0; n < e.length; n++) t.u8(e[n]);
		return;
	}
	if (r === "i32") {
		t.u8(8), t.varuint(e.length);
		for (let n = 0; n < e.length; n++) t.i32(e[n]);
		return;
	}
	if (r === "f64") {
		t.u8(9), t.varuint(e.length);
		for (let n = 0; n < e.length; n++) t.f64(e[n]);
		return;
	}
	t.u8(5), t.varuint(e.length);
	for (let r = 0; r < e.length; r++) Re(e[r], t, n);
}
function Le(e, t, n) {
	if (!Ne(e)) throw TypeError("Only plain objects are supported");
	if (Object.getOwnPropertySymbols(e).length > 0) throw TypeError("Symbol keys are not supported");
	let r = Object.getOwnPropertyNames(e), i = Object.keys(e);
	if (r.length !== i.length) throw TypeError("Non-enumerable properties are not supported");
	for (let t of i) {
		let n = Object.getOwnPropertyDescriptor(e, t);
		if (!n || !("value" in n)) throw TypeError(`Accessor property is not supported: ${t}`);
	}
	t.u8(6), t.varuint(i.length);
	for (let r of i) Fe(r, t), Re(e[r], t, n);
}
function Re(e, t, n) {
	if (e === null) {
		t.u8(0);
		return;
	}
	if (e === !1) {
		t.u8(1);
		return;
	}
	if (e === !0) {
		t.u8(2);
		return;
	}
	if (typeof e == "number") {
		if (!Number.isFinite(e)) throw TypeError(`Invalid JSON number: ${e}`);
		t.u8(3), t.f64(e);
		return;
	}
	if (typeof e == "string") {
		Fe(e, t);
		return;
	}
	if (Array.isArray(e)) {
		if (n.seen.has(e)) throw TypeError("Circular reference detected");
		if (n.seen.add(e), n.depth++, n.depth > je) throw Error("Maximum nesting depth exceeded");
		Ie(e, t, n), n.depth--, n.seen.delete(e);
		return;
	}
	if (typeof e == "object") {
		if (n.seen.has(e)) throw TypeError("Circular reference detected");
		if (n.seen.add(e), n.depth++, n.depth > je) throw Error("Maximum nesting depth exceeded");
		Le(e, t, n), n.depth--, n.seen.delete(e);
		return;
	}
	throw TypeError(`Unsupported value type: ${typeof e}`);
}
//#endregion
//#region src/codec/decode.ts
var ze = new TextDecoder("utf-8", { fatal: !0 });
function Be(e) {
	let t = new ke(e), n = He(t, 0);
	if (!t.done()) throw Error("Trailing bytes after root value");
	return n;
}
var Ve = 1e3;
function He(e, t) {
	if (t > Ve) throw Error("Maximum nesting depth exceeded");
	let n = e.u8();
	switch (n) {
		case 0: return null;
		case 1: return !1;
		case 2: return !0;
		case 3: return e.f64();
		case 4: return Ue(e);
		case 5: return We(e, t + 1);
		case 6: return Ge(e, t + 1);
		case 7: return Ke(e);
		case 8: return qe(e);
		case 9: return Je(e);
		default: throw TypeError(`Unknown tag: ${n}`);
	}
}
function Ue(e) {
	let t = e.varuint(), n = e.bytes(t);
	return ze.decode(n);
}
function We(e, t) {
	let n = e.varuint(), r = Array(n);
	for (let i = 0; i < n; i++) r[i] = He(e, t);
	return r;
}
function Ge(e, t) {
	let n = e.varuint(), r = {};
	for (let i = 0; i < n; i++) {
		let n = He(e, t);
		if (typeof n != "string") throw TypeError("Object key is not a string");
		r[n] = He(e, t);
	}
	return r;
}
function Ke(e) {
	let t = e.varuint(), n = Array(t);
	for (let r = 0; r < t; r++) n[r] = e.u8();
	return n;
}
function qe(e) {
	let t = e.varuint(), n = Array(t);
	for (let r = 0; r < t; r++) n[r] = e.i32();
	return n;
}
function Je(e) {
	let t = e.varuint(), n = Array(t);
	for (let r = 0; r < t; r++) n[r] = e.f64();
	return n;
}
//#endregion
//#region src/shared_array_buffer/base_call_allocator.ts
var Ye = 10 * 1024 * 1024, Xe = 64, Ze = 2147483640, Qe = 32, j = 4, $e = j * Int32Array.BYTES_PER_ELEMENT, M = 8, et = 2056, tt = 1111703858, nt = 1, N = 0, P = 1, F = 2, rt = 3, I = 4, it = 5, at = 6, ot = 7, L = 0, R = 1, z = 2, B = 3, st = class e {
	share_arrays_memory;
	constructor(e = Ye) {
		if (!Number.isInteger(e) || e < Xe || e > Ze || e % 8 != 0) throw RangeError(`byteLength must be an 8-byte multiple from ${Xe} through ${Ze}`);
		let t = Math.max(1, Math.min(et, Math.floor((e - Qe) / ($e + M)), Math.max(4, Math.floor((e - Qe) / 64)))), n = Qe + t * $e;
		if (n + M > e) throw RangeError("byteLength cannot hold allocator metadata");
		this.share_arrays_memory = new SharedArrayBuffer(e);
		let r = new Int32Array(this.share_arrays_memory);
		r[N] = 0, r[P] = 0, r[F] = 0, r[rt] = tt, r[I] = 1, r[it] = t, r[at] = n, r[ot] = nt, r[8] = n, r[9] = e - n, r[10] = 0, r[11] = 1;
	}
	static init_self(t) {
		let n = t?.share_arrays_memory;
		if (!(n instanceof SharedArrayBuffer)) throw TypeError("allocator object must contain a SharedArrayBuffer");
		if (n.byteLength < Xe || n.byteLength > Ze || n.byteLength % 8 != 0) throw RangeError("allocator object has an invalid buffer size");
		e.validate_header(new Int32Array(n));
		let r = Object.create(e.prototype);
		return Object.defineProperty(r, "share_arrays_memory", {
			value: n,
			enumerable: !0
		}), r;
	}
	block_write(e) {
		let t = new Uint8Array(e);
		if (t.byteLength === 0) return [0, 0];
		let n = this.with_blocking_lock((e) => this.reserve_locked(e, t.byteLength));
		try {
			new Uint8Array(this.share_arrays_memory, ...n).set(t);
		} catch (e) {
			throw this.free(...n), e;
		}
		return n;
	}
	async async_write(e) {
		let t = new Uint8Array(e);
		if (t.byteLength === 0) return [0, 0];
		let n = await this.with_async_lock((e) => this.reserve_locked(e, t.byteLength));
		try {
			new Uint8Array(this.share_arrays_memory, ...n).set(t);
		} catch (e) {
			throw await this.async_free(...n), e;
		}
		return n;
	}
	get_memory(e, t) {
		if (e === 0 && t === 0) return /* @__PURE__ */ new ArrayBuffer(0);
		this.with_blocking_lock((n) => {
			this.find_allocated_extent(n, e, t);
		});
		let n = new ArrayBuffer(t);
		return new Uint8Array(n).set(new Uint8Array(this.share_arrays_memory, e, t)), n;
	}
	async async_get_memory(e, t) {
		if (e === 0 && t === 0) return /* @__PURE__ */ new ArrayBuffer(0);
		await this.with_async_lock((n) => {
			this.find_allocated_extent(n, e, t);
		});
		let n = new ArrayBuffer(t);
		return new Uint8Array(n).set(new Uint8Array(this.share_arrays_memory, e, t)), n;
	}
	free(e, t) {
		e === 0 && t === 0 || this.with_blocking_lock((n) => {
			this.release_locked(n, e, t);
		});
	}
	async async_free(e, t) {
		e === 0 && t === 0 || await this.with_async_lock((n) => {
			this.release_locked(n, e, t);
		});
	}
	get_object() {
		return { share_arrays_memory: this.share_arrays_memory };
	}
	reserve_locked(e, t) {
		if (!Number.isInteger(t) || t <= 0 || t > Ze) throw RangeError("invalid allocation length");
		this.validate_metadata(e);
		let n = Math.ceil(t / M) * M, r = e[I], i = e[F] % r;
		for (let a = 0; a < r; a++) {
			let o = (i + a) % r, s = this.extent_word(o), c = e[s + R];
			if (e[s + B] !== 1 || c < n) continue;
			let l = c - n;
			if (l >= M && r < e[it]) {
				this.insert_extent(e, o + 1);
				let t = this.extent_word(o + 1);
				e[t + L] = e[s + L] + n, e[t + R] = l, e[t + z] = 0, e[t + B] = 1, e[s + R] = n;
			}
			return e[s + B] = 0, e[s + z] = t, Atomics.add(e, P, 1), e[F] = o + 1 < e[I] ? o + 1 : 0, [e[s + L], t];
		}
		throw RangeError("base call allocator is out of memory");
	}
	with_blocking_lock(e) {
		let t = new Int32Array(this.share_arrays_memory);
		for (;;) {
			let e = Atomics.compareExchange(t, N, 0, 1);
			if (e === 0) break;
			if (e !== 1) throw Error("corrupt allocator lock");
			Atomics.wait(t, N, 1);
		}
		try {
			return e(t);
		} finally {
			Atomics.store(t, N, 0), Atomics.notify(t, N, 1);
		}
	}
	async with_async_lock(e) {
		let t = new Int32Array(this.share_arrays_memory);
		for (;;) {
			let e = Atomics.compareExchange(t, N, 0, 1);
			if (e === 0) break;
			if (e !== 1) throw Error("corrupt allocator lock");
			let n = Atomics.waitAsync(t, N, 1).value;
			n instanceof Promise && await n;
		}
		try {
			return e(t);
		} finally {
			Atomics.store(t, N, 0), Atomics.notify(t, N, 1);
		}
	}
	find_allocated_extent(e, t, n) {
		if (this.validate_metadata(e), !Number.isInteger(t) || !Number.isInteger(n) || t < e[at] || t % M !== 0 || n <= 0 || t + n > this.share_arrays_memory.byteLength) throw RangeError("invalid allocation range");
		let r = e[I];
		for (let i = 0; i < r; i++) {
			let r = this.extent_word(i);
			if (e[r + L] === t) {
				if (e[r + B] !== 0) throw Error("allocation has already been freed");
				if (e[r + z] !== n) throw RangeError("allocation length does not match");
				return i;
			}
		}
		throw RangeError("allocation pointer was not found");
	}
	static validate_header(e) {
		if (Atomics.load(e, rt) !== tt) throw Error("allocator object has invalid magic");
		let t = Atomics.load(e, ot), n = Atomics.load(e, it), r = Atomics.load(e, at);
		if (t !== nt || n < 1 || n > et || r !== Qe + n * $e || r % M !== 0 || r + M > e.buffer.byteLength) throw Error("corrupt allocator metadata");
	}
	validate_metadata(t) {
		e.validate_header(t);
		let n = t[I];
		if (n < 1 || n > t[it] || t[F] < 0 || t[F] >= n || t[P] < 0 || t[P] > n) throw Error("corrupt allocator metadata");
		let r = t[at], i = 0;
		for (let e = 0; e < n; e++) {
			let n = this.extent_word(e), a = t[n + L], o = t[n + R], s = t[n + z], c = t[n + B];
			if (a !== r || a % M !== 0 || o < M || o % M !== 0 || a + o > this.share_arrays_memory.byteLength || c !== 0 && c !== 1 || c === 1 && s !== 0 || c === 0 && (s < 1 || s > o) || (c === 0 && i++, e > 0 && c === 1 && t[this.extent_word(e - 1) + B] === 1)) throw Error("corrupt allocator extent table");
			r += o;
		}
		if (r !== this.share_arrays_memory.byteLength || i !== t[P]) throw Error("corrupt allocator extent table");
		for (let e = n; e < t[it]; e++) {
			let n = this.extent_word(e);
			if (t[n + L] !== 0 || t[n + R] !== 0 || t[n + z] !== 0 || t[n + B] !== 0) throw Error("corrupt allocator extent table");
		}
	}
	insert_extent(e, t) {
		let n = e[I];
		for (let r = n; r > t; r--) {
			let t = this.extent_word(r), n = this.extent_word(r - 1);
			e.copyWithin(t, n, n + j);
		}
		e[I] = n + 1;
	}
	remove_extent(e, t) {
		let n = e[I];
		for (let r = t; r < n - 1; r++) {
			let t = this.extent_word(r), n = this.extent_word(r + 1);
			e.copyWithin(t, n, n + j);
		}
		let r = this.extent_word(n - 1);
		e.fill(0, r, r + j), e[I] = n - 1, e[F] > t && e[F]--;
	}
	extent_word(e) {
		return Qe / 4 + e * j;
	}
	release_locked(e, t, n) {
		let r = this.find_allocated_extent(e, t, n), i = this.extent_word(r);
		if (e[i + B] = 1, e[i + z] = 0, Atomics.sub(e, P, 1), r + 1 < e[I]) {
			let t = this.extent_word(r + 1);
			e[t + B] === 1 && (e[i + R] += e[t + R], this.remove_extent(e, r + 1));
		}
		if (r > 0) {
			let t = this.extent_word(r - 1);
			e[t + B] === 1 && (e[t + R] += e[i + R], this.remove_extent(e, r));
		}
		e[F] >= e[I] && (e[F] = 0);
	}
}, ct = 8, lt = 0, V = 1, H = 2, U = 3, ut = 5, dt = 12, W = 0, G = 1, ft = 2, K = 3, pt = 4, mt = 5, q = 6, J = 7, Y = 8, X = 9, ht = 10, gt = 11, Z = 0, _t = 128, vt = 1024, yt = 2147483647, bt = 65536, xt = 8, St = {}, Ct = function(e) {
	return e[e.SetParkFdsMap = 0] = "SetParkFdsMap", e[e.DestroyPark = 1] = "DestroyPark", e[e.CallUnknownFn = 2] = "CallUnknownFn", e;
}({}), wt = function(e) {
	return e[e.Serialized = 1] = "Serialized", e[e.OutOfMemory = 2] = "OutOfMemory", e[e.InvalidRequest = 3] = "InvalidRequest", e[e.Destroyed = 4] = "Destroyed", e[e.CodecError = 5] = "CodecError", e;
}({}), Tt = class extends Error {
	constructor() {
		super("base call capacity is exhausted or permanently retired"), this.name = "BaseCallCapacityError";
	}
}, Q = class extends Error {
	status;
	constructor(e) {
		super(`base call failed: ${wt[e]}`), this.status = e, this.name = `BaseCall${wt[e]}Error`;
	}
}, Et = class e {
	control;
	slots;
	allocator;
	userSlotCount;
	userSlotScanHint = 1;
	constructor(e, t, n, r) {
		this.control = e, this.slots = t, this.allocator = n, this.userSlotCount = r;
	}
	static init_self(t) {
		if (t?.version !== 2) throw TypeError("base call transport version must be 2");
		if (!Number.isInteger(t.userSlotCount) || t.userSlotCount < 1 || t.userSlotCount > vt) throw RangeError("base call user-slot count is invalid");
		if (!(t.control instanceof SharedArrayBuffer)) throw TypeError("base call control must be a SharedArrayBuffer");
		if (t.control.byteLength !== ct * Int32Array.BYTES_PER_ELEMENT) throw RangeError("base call control has an invalid size");
		if (!(t.slots instanceof SharedArrayBuffer)) throw TypeError("base call slots must be a SharedArrayBuffer");
		let n = (t.userSlotCount + 1) * dt * Int32Array.BYTES_PER_ELEMENT;
		if (t.slots.byteLength !== n) throw RangeError("base call slots have an invalid size");
		let r = new Int32Array(t.control);
		if (Atomics.load(r, lt) !== 2) throw Error("base call control has an invalid protocol version");
		if (Atomics.load(r, ut) !== t.userSlotCount) throw Error("base call control has a mismatched user-slot count");
		let i = Atomics.load(r, V);
		if (i !== 0 && i !== 1 && i !== 2) throw Error("base call control has an invalid lifecycle");
		let a = st.init_self(t.allocator);
		return new e(r, new Int32Array(t.slots), a, t.userSlotCount);
	}
	block_call(e, t) {
		this.validatePayload(t);
		let n = this.isSystemOpcode(e), r = n ? this.claimSystemSlotBlocking(e) : this.tryClaimUserSlot();
		if (r === void 0) {
			if (e === 1) return;
			throw n || Atomics.load(this.control, V) !== 0 ? new Q(4) : new Tt();
		}
		try {
			this.publishBlocking(r, e, t);
		} catch (t) {
			if (this.isIdempotentDestroyFailure(e, t)) return;
			throw t;
		}
		return this.waitForTerminalBlocking(r, e);
	}
	async async_call(e, t) {
		this.validatePayload(t);
		let n = this.isSystemOpcode(e) ? await this.claimSystemSlotAsync(e) : await this.claimUserSlotAsync();
		if (n === void 0) {
			if (e === 1) return;
			throw new Q(4);
		}
		try {
			await this.publishAsync(n, e, t);
		} catch (t) {
			if (this.isIdempotentDestroyFailure(e, t)) return;
			throw t;
		}
		return await this.waitForTerminalAsync(n, e);
	}
	validatePayload(e) {
		if (!(e instanceof Uint8Array)) throw TypeError("base call payload must be a Uint8Array");
	}
	isSystemOpcode(e) {
		return e === 0 || e === 1;
	}
	isIdempotentDestroyFailure(e, t) {
		return e === 1 && t instanceof Q && t.status === 4;
	}
	tryClaimUserSlot() {
		if (Atomics.load(this.control, V) !== 0) return;
		let e = 0, t = this.userSlotScanHint;
		for (let n = 0; n < this.userSlotCount; n++) {
			let r = (t - 1 + n) % this.userSlotCount + 1, i = this.slotWord(r, W), a = Atomics.load(this.slots, i);
			if (a === 7) {
				e++;
				continue;
			}
			if (a !== 0 || (St.beforeUserSlotClaim?.(r), Atomics.compareExchange(this.slots, i, 0, 1) !== 0)) continue;
			let o = this.slotWord(r, G), s = Atomics.load(this.slots, o);
			if (s >= yt) {
				Atomics.store(this.slots, i, 7), e++, this.notifySlotFreed(r);
				continue;
			}
			let c = s + 1;
			return Atomics.store(this.slots, o, c), this.clearSlotMetadata(r), this.userSlotScanHint = r % this.userSlotCount + 1, {
				slotIndex: r,
				generation: c
			};
		}
		if (e === this.userSlotCount) throw new Tt();
	}
	async claimUserSlotAsync() {
		for (;;) {
			let e = Atomics.load(this.control, U), t = this.tryClaimUserSlot();
			if (t !== void 0) return t;
			if (Atomics.load(this.control, V) !== 0) return;
			await kt(this.control, U, e);
		}
	}
	tryClaimSystemSlot() {
		if (Atomics.load(this.control, V) !== 0) return;
		let e = this.slotWord(Z, W);
		if (Atomics.load(this.slots, e) === 7) throw new Tt();
		if (Atomics.compareExchange(this.slots, e, 0, 1) !== 0) return;
		let t = this.slotWord(Z, G), n = Atomics.load(this.slots, t);
		if (n >= yt) throw Atomics.store(this.slots, e, 7), Atomics.notify(this.slots, e), new Tt();
		let r = n + 1;
		return Atomics.store(this.slots, t, r), this.clearSlotMetadata(Z), {
			slotIndex: Z,
			generation: r
		};
	}
	claimSystemSlotBlocking(e) {
		let t = this.slotWord(Z, W);
		for (;;) {
			let n = Atomics.load(this.slots, t), r = this.tryClaimSystemSlot();
			if (r !== void 0) return r;
			if (Atomics.load(this.control, V) !== 0) {
				if (e === 1) return;
				throw new Q(4);
			}
			Atomics.wait(this.slots, t, n);
		}
	}
	async claimSystemSlotAsync(e) {
		let t = this.slotWord(Z, W);
		for (;;) {
			let n = Atomics.load(this.slots, t), r = this.tryClaimSystemSlot();
			if (r !== void 0) return r;
			if (Atomics.load(this.control, V) !== 0) {
				if (e === 1) return;
				throw new Q(4);
			}
			await kt(this.slots, t, n);
		}
	}
	publishBlocking(e, t, n) {
		let r;
		try {
			r = this.allocator.block_write(n);
		} catch {
			throw this.releaseWritingSlot(e), new Q(2);
		}
		try {
			this.publishOwnedRequest(e, t, r), r = void 0;
		} finally {
			r !== void 0 && (this.allocator.free(...r), this.releaseWritingSlot(e));
		}
	}
	async publishAsync(e, t, n) {
		let r;
		try {
			r = await this.allocator.async_write(n);
		} catch {
			throw this.releaseWritingSlot(e), new Q(2);
		}
		try {
			this.publishOwnedRequest(e, t, r), r = void 0;
		} finally {
			if (r !== void 0) try {
				await this.allocator.async_free(...r);
			} finally {
				this.releaseWritingSlot(e);
			}
		}
	}
	publishOwnedRequest(e, t, n) {
		St.beforeRequestPublication?.(e.slotIndex, t);
		let r = this.slotWord(e.slotIndex, 0);
		if (Atomics.store(this.slots, r + ft, t), Atomics.store(this.slots, r + K, 0), Atomics.store(this.slots, r + pt, n[0]), Atomics.store(this.slots, r + mt, n[1]), Atomics.store(this.slots, r + q, 0), Atomics.store(this.slots, r + J, 0), Atomics.store(this.slots, r + Y, 0), Atomics.store(this.slots, r + X, 0), Atomics.store(this.slots, r + ht, 0), Atomics.store(this.slots, r + gt, 0), Atomics.load(this.control, V) !== 0 || Atomics.load(this.slots, r + G) !== e.generation || Atomics.compareExchange(this.slots, r + W, 1, 2) !== 1) throw new Q(4);
		Atomics.add(this.control, H, 1), Atomics.notify(this.control, H);
	}
	releaseWritingSlot(e) {
		let t = this.slotWord(e.slotIndex, W);
		if (Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) === e.generation) {
			let n = Atomics.load(this.slots, t);
			(n === 1 || n === 6) && (Atomics.compareExchange(this.slots, t, n, 0), this.notifySlotFreed(e.slotIndex));
		}
	}
	waitForTerminalBlocking(e, t) {
		let n = this.slotWord(e.slotIndex, W);
		for (;;) {
			let r = Atomics.load(this.slots, n);
			if (Ot(r)) return this.consumeTerminal(e, t, r);
			this.assertGeneration(e), Atomics.wait(this.slots, n, r);
		}
	}
	async waitForTerminalAsync(e, t) {
		let n = this.slotWord(e.slotIndex, W);
		for (;;) {
			let r = Atomics.load(this.slots, n);
			if (Ot(r)) return await this.consumeTerminalAsync(e, t, r);
			this.assertGeneration(e), await kt(this.slots, n, r);
		}
	}
	consumeTerminal(e, t, n) {
		this.assertGeneration(e);
		let r = this.slotWord(e.slotIndex, 0), i;
		try {
			if (n === 4) {
				let e = Atomics.load(this.slots, r + q), t = Atomics.load(this.slots, r + J);
				return e === 0 && t === 0 ? void 0 : (i = [e, t], new Uint8Array(this.allocator.get_memory(e, t)));
			}
			if (n === 6) {
				if (t === 1) return;
				throw new Q(4);
			}
			let e = Atomics.load(this.slots, r + K);
			if (e === 1) {
				let e = Atomics.load(this.slots, r + Y), t = Atomics.load(this.slots, r + X);
				throw i = [e, t], Ft(Be(new Uint8Array(this.allocator.get_memory(e, t))));
			}
			throw e === 2 || e === 3 || e === 4 || e === 5 ? new Q(e) : new Q(3);
		} finally {
			i !== void 0 && this.allocator.free(...i), this.releaseTerminalSlot(e, n);
		}
	}
	async consumeTerminalAsync(e, t, n) {
		this.assertGeneration(e);
		let r = this.slotWord(e.slotIndex, 0), i;
		try {
			if (n === 6) {
				if (t === 1) return;
				throw new Q(4);
			}
			let e = Atomics.load(this.slots, r + K);
			if (n === 4 || e === 1) {
				let e = Atomics.load(this.slots, r + (n === 4 ? q : Y)), t = Atomics.load(this.slots, r + (n === 4 ? J : X));
				if (n === 4 && e === 0 && t === 0) return;
				i = [e, t];
				let a = new Uint8Array(await this.allocator.async_get_memory(e, t));
				if (n === 4) return a;
				throw Ft(Be(a));
			}
			throw e === 2 || e === 3 || e === 4 || e === 5 ? new Q(e) : new Q(3);
		} finally {
			try {
				i !== void 0 && await this.allocator.async_free(...i);
			} finally {
				this.releaseTerminalSlot(e, n);
			}
		}
	}
	releaseTerminalSlot(e, t) {
		let n = this.slotWord(e.slotIndex, W);
		Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) === e.generation && (this.clearSlotMetadata(e.slotIndex), Atomics.compareExchange(this.slots, n, t, 0) === t && this.notifySlotFreed(e.slotIndex));
	}
	notifySlotFreed(e) {
		let t = this.slotWord(e, W);
		Atomics.notify(this.slots, t), e !== Z && (Atomics.add(this.control, U, 1), Atomics.notify(this.control, U));
	}
	clearSlotMetadata(e) {
		let t = this.slotWord(e, 0);
		for (let e = ft; e < dt; e++) Atomics.store(this.slots, t + e, 0);
	}
	assertGeneration(e) {
		if (Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) !== e.generation) throw Error("base call slot generation changed while owned");
	}
	slotWord(e, t) {
		return e * dt + t;
	}
}, Dt = class {
	control;
	slots;
	allocator;
	handler;
	userSlotCount;
	onBeginDestroy;
	listening = !1;
	destroyOrigin;
	constructor(e, t) {
		if (typeof e != "function") throw TypeError("base call handler must be a function");
		let n = t?.maxBaseCalls ?? _t;
		if (!Number.isInteger(n) || n < 1 || n > vt) throw RangeError("maxBaseCalls must be an integer from 1 through 1024");
		this.handler = e, this.userSlotCount = n, this.onBeginDestroy = t?.onBeginDestroy, this.allocator = new st(t?.allocatorBytes), this.control = new Int32Array(new SharedArrayBuffer(ct * Int32Array.BYTES_PER_ELEMENT)), this.slots = new Int32Array(new SharedArrayBuffer((n + 1) * dt * Int32Array.BYTES_PER_ELEMENT)), Atomics.store(this.control, lt, 2), Atomics.store(this.control, V, 0), Atomics.store(this.control, H, 0), Atomics.store(this.control, U, 0), Atomics.store(this.control, 4, 0), Atomics.store(this.control, ut, n), Atomics.store(this.control, 6, 0), Atomics.store(this.control, 7, 0);
		for (let e = 0; e < this.slots.length; e++) Atomics.store(this.slots, e, 0);
	}
	get_object() {
		return {
			version: 2,
			userSlotCount: this.userSlotCount,
			control: this.control.buffer,
			slots: this.slots.buffer,
			allocator: this.allocator.get_object()
		};
	}
	listen() {
		this.listening || (this.listening = !0, this.listenLoop());
	}
	destroy() {
		this.beginDestroy();
	}
	async listenLoop() {
		for (; Atomics.load(this.control, V) === 0;) {
			let e = Atomics.load(this.control, H);
			if (this.scanAndClaimReadySlots()) {
				await At();
				continue;
			}
			St.beforeDispatcherWait?.(), await kt(this.control, H, e);
		}
		this.destroyOrigin !== void 0 && await this.waitForOriginRelease(this.destroyOrigin), this.listening = !1;
	}
	scanAndClaimReadySlots() {
		let e = !1;
		for (let t = 0; t <= this.userSlotCount; t++) {
			let n = this.slotWord(t, W);
			if (Atomics.compareExchange(this.slots, n, 2, 3) !== 2) continue;
			e = !0;
			let r = {
				slotIndex: t,
				generation: Atomics.load(this.slots, this.slotWord(t, G))
			}, i = this.slotWord(t, 0), a = Atomics.load(this.slots, i + ft), o = Atomics.load(this.slots, i + pt), s = Atomics.load(this.slots, i + mt);
			this.readAndHandleSlot(r, a, o, s).catch(() => {
				this.publishTerminalError(r, 3);
			});
		}
		return e;
	}
	async readAndHandleSlot(e, t, n, r) {
		let i;
		try {
			i = new Uint8Array(await this.allocator.async_get_memory(n, r));
		} finally {
			await this.allocator.async_free(n, r);
		}
		if (!(Atomics.load(this.control, V) !== 0 || !this.ownsRunningSlot(e))) {
			if (e.slotIndex === Z) {
				if (t === 1) {
					St.beforeWireDestroy?.(), this.beginDestroy(e) || await this.publishSuccess(e, void 0);
					return;
				}
				if (t !== 0) {
					this.publishTerminalError(e, 3);
					return;
				}
			} else if (t !== 2) {
				this.publishTerminalError(e, 3);
				return;
			}
			await this.handleSlot(e, t, i);
		}
	}
	async handleSlot(e, t, n) {
		let r;
		try {
			r = await this.handler(t, n);
		} catch (t) {
			await this.publishSerializedError(e, t);
			return;
		}
		if (r !== void 0 && !(r instanceof Uint8Array)) {
			this.publishTerminalError(e, 5);
			return;
		}
		if (r === void 0 || r.byteLength === 0) {
			await this.publishSuccess(e, void 0);
			return;
		}
		let i;
		try {
			i = await this.allocator.async_write(r);
		} catch {
			this.publishTerminalError(e, 2);
			return;
		}
		await this.publishSuccess(e, i);
	}
	async publishSuccess(e, t) {
		if (!this.ownsRunningSlot(e)) {
			t !== void 0 && await this.allocator.async_free(...t);
			return;
		}
		let n = this.slotWord(e.slotIndex, 0);
		Atomics.store(this.slots, n + K, 0), Atomics.store(this.slots, n + q, t?.[0] ?? 0), Atomics.store(this.slots, n + J, t?.[1] ?? 0), Atomics.store(this.slots, n + Y, 0), Atomics.store(this.slots, n + X, 0), this.publishTerminalState(e, 4) || t !== void 0 && await this.allocator.async_free(...t);
	}
	async publishSerializedError(e, t) {
		if (!this.ownsRunningSlot(e)) return;
		let n;
		try {
			n = Me(jt(t));
		} catch {
			this.publishTerminalError(e, 5);
			return;
		}
		let r;
		try {
			r = await this.allocator.async_write(n);
		} catch {
			this.publishTerminalError(e, 2);
			return;
		}
		if (!this.ownsRunningSlot(e)) {
			await this.allocator.async_free(...r);
			return;
		}
		let i = this.slotWord(e.slotIndex, 0);
		Atomics.store(this.slots, i + K, 1), Atomics.store(this.slots, i + q, 0), Atomics.store(this.slots, i + J, 0), Atomics.store(this.slots, i + Y, r[0]), Atomics.store(this.slots, i + X, r[1]), this.publishTerminalState(e, 5) || await this.allocator.async_free(...r);
	}
	publishTerminalError(e, t) {
		if (!this.ownsRunningSlot(e)) return;
		let n = this.slotWord(e.slotIndex, 0);
		Atomics.store(this.slots, n + K, t), Atomics.store(this.slots, n + q, 0), Atomics.store(this.slots, n + J, 0), Atomics.store(this.slots, n + Y, 0), Atomics.store(this.slots, n + X, 0), this.publishTerminalState(e, 5);
	}
	publishTerminalState(e, t) {
		if (Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) !== e.generation) return !1;
		let n = this.slotWord(e.slotIndex, W);
		return Atomics.compareExchange(this.slots, n, 3, t) === 3 ? (Atomics.notify(this.slots, n), !0) : !1;
	}
	ownsRunningSlot(e) {
		return Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) === e.generation && Atomics.load(this.slots, this.slotWord(e.slotIndex, W)) === 3;
	}
	beginDestroy(e) {
		if (Atomics.compareExchange(this.control, V, 0, 1) !== 0) return !1;
		e !== void 0 && (this.destroyOrigin = e);
		try {
			this.onBeginDestroy?.();
		} catch {}
		for (let t = 0; t <= this.userSlotCount; t++) this.cancelSlot(t, e);
		Atomics.store(this.control, V, 2), Atomics.add(this.control, H, 1), Atomics.notify(this.control, H), Atomics.add(this.control, U, 1), Atomics.notify(this.control, U);
		for (let e = 0; e <= this.userSlotCount; e++) Atomics.notify(this.slots, this.slotWord(e, W));
		return e !== void 0 && this.publishTerminalState(e, 4), !0;
	}
	cancelSlot(e, t) {
		let n = this.slotWord(e, G), r = this.slotWord(e, W);
		for (;;) {
			let i = Atomics.load(this.slots, n);
			if (t !== void 0 && t.slotIndex === e && t.generation === i) return;
			let a = Atomics.load(this.slots, r);
			if (a === 1 || a === 3) {
				if (Atomics.compareExchange(this.slots, r, a, 6) === a) {
					Atomics.notify(this.slots, r);
					return;
				}
				continue;
			}
			if (a === 2) {
				if (Atomics.compareExchange(this.slots, r, 2, 3) !== 2) continue;
				let t = Atomics.load(this.slots, this.slotWord(e, pt)), n = Atomics.load(this.slots, this.slotWord(e, mt));
				Atomics.store(this.slots, r, 6), Atomics.notify(this.slots, r), this.allocator.async_free(t, n).catch(() => {});
				return;
			}
			return;
		}
	}
	async waitForOriginRelease(e) {
		let t = this.slotWord(e.slotIndex, W);
		for (; Atomics.load(this.slots, this.slotWord(e.slotIndex, G)) === e.generation;) {
			let e = Atomics.load(this.slots, t);
			if (e === 0 || e === 7) return;
			await kt(this.slots, t, e);
		}
	}
	slotWord(e, t) {
		return e * dt + t;
	}
};
function Ot(e) {
	return e === 4 || e === 5 || e === 6;
}
async function kt(e, t, n) {
	let r = Atomics.waitAsync(e, t, n).value;
	r instanceof Promise && await r;
}
function At() {
	return new Promise((e) => setTimeout(e, 0));
}
function jt(e) {
	let t = /* @__PURE__ */ new WeakSet();
	typeof e == "object" && e && t.add(e);
	let n = {
		name: Nt($(e, "name"), "Error"),
		message: Nt($(e, "message"), Pt(e))
	}, r = $(e, "stack");
	r !== void 0 && (n.stack = Nt(r, ""));
	let i = $(e, "cause");
	return i !== void 0 && (n.cause = Mt(i, t, 0)), n;
}
function Mt(e, t, n) {
	if (e === null || typeof e == "boolean" || typeof e == "string") return typeof e == "string" ? e.slice(0, bt) : e;
	if (typeof e == "number") return Number.isFinite(e) ? e : Pt(e);
	if (typeof e != "object") return Pt(e).slice(0, bt);
	if (t.has(e)) return "[Circular]";
	if (n >= xt) return "[Truncated]";
	t.add(e);
	let r = {
		name: Nt($(e, "name"), "Error"),
		message: Nt($(e, "message"), Pt(e))
	}, i = $(e, "cause");
	return i !== void 0 && (r.cause = Mt(i, t, n + 1)), t.delete(e), r;
}
function $(e, t) {
	if (!((typeof e != "object" || !e) && typeof e != "function")) try {
		return Reflect.get(e, t);
	} catch {
		return;
	}
}
function Nt(e, t) {
	return e === void 0 ? t.slice(0, bt) : Pt(e).slice(0, bt);
}
function Pt(e) {
	try {
		return String(e);
	} catch {
		return "unprintable error";
	}
}
function Ft(e) {
	if (e === null || Array.isArray(e) || typeof e != "object") return /* @__PURE__ */ Error("invalid serialized base call error");
	let t = typeof e.name == "string" ? e.name : "Error", n = typeof e.message == "string" ? e.message : "", r = t === "TypeError" ? TypeError(n) : Error(n);
	return r.name = t, typeof e.stack == "string" && (r.stack = e.stack), "cause" in e && (r.cause = e.cause), r;
}
var It = class extends we {
	allocator;
	lock_fds;
	fds_len_and_num;
	listen_fds = [];
	listen_fds_terminator = [];
	fd_func_sig;
	baseCall;
	destroyed = !1;
	fd_close_receiver;
	constructor(e, t, n, r, i, a, o, s, c, l) {
		super(e, t, n, r, i, s), this.baseCall = new Dt(this.handleBaseCall.bind(this), {
			maxBaseCalls: c,
			allocatorBytes: l,
			onBeginDestroy: () => this.stopFdListeners()
		}), a === void 0 ? this.allocator = new u() : this.allocator = new u(new SharedArrayBuffer(a));
		let d = o ?? 128;
		this.lock_fds = new SharedArrayBuffer(4 * d * 3), this.fd_func_sig = new SharedArrayBuffer(72 * d), this.fds_len_and_num = new SharedArrayBuffer(8);
		let f = new Int32Array(this.fds_len_and_num);
		Atomics.store(f, 0, e.length), Atomics.store(f, 1, 0), this.fd_close_receiver = new Ee();
	}
	destroy() {
		this.baseCall.destroy();
	}
	stopFdListeners() {
		this.destroyed = !0;
		for (let e = 0; e < this.listen_fds_terminator.length; e++) {
			let t = this.listen_fds_terminator[e];
			t && (t(), this.listen_fds_terminator[e] = null);
		}
	}
	get_ref() {
		return {
			allocator: this.allocator.get_object(),
			lock_fds: this.lock_fds,
			fds_len_and_num: this.fds_len_and_num,
			fd_func_sig: this.fd_func_sig,
			baseCall: this.baseCall.get_object(),
			fd_close_receiver: this.fd_close_receiver.get_object(),
			stdin: this.stdin,
			stdout: this.stdout,
			stderr: this.stderr,
			default_fds: this.default_allow_fds
		};
	}
	async notify_set_fd(e) {
		if (this.destroyed) return;
		if (this.fds[e] === void 0) throw Error("fd is not defined");
		if (e >= 128) throw Error("fd is too big. expand is not supported yet");
		if (this.listen_fds[e] !== void 0 && this.listen_fds[e] instanceof Promise && await this.listen_fds[e], this.destroyed) return;
		let { promise: t, terminate: n } = this.listen_fd(e);
		this.listen_fds[e] = t.catch(() => void 0), this.listen_fds_terminator[e] = n;
		let r = new Int32Array(this.fds_len_and_num);
		Atomics.store(r, 0, this.fds.length);
	}
	async notify_rm_fd(e) {
		(async () => {
			await this.listen_fds[e], this.listen_fds[e] = void 0, this.listen_fds_terminator[e] = void 0;
		})(), await this.fd_close_receiver.send(this.fds_map[e], e), this.fds_map[e] = [];
	}
	can_set_new_fd(e) {
		return this.listen_fds[e] instanceof Promise ? [!1, this.listen_fds[e]] : [!0, void 0];
	}
	listen() {
		if (!this.destroyed) {
			this.listen_fds = [];
			for (let e = 0; e < this.fds.length; e++) {
				let { promise: t, terminate: n } = this.listen_fd(e);
				this.listen_fds.push(t.catch(() => void 0)), this.listen_fds_terminator.push(n);
			}
			this.baseCall.listen();
		}
	}
	async handleBaseCall(e, t) {
		if (e === Ct.SetParkFdsMap) {
			if (t.byteLength < Uint32Array.BYTES_PER_ELEMENT || t.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) throw TypeError("fd-map payload must contain an id and whole fds");
			let e = new Uint32Array(t.buffer, t.byteOffset, t.byteLength / Uint32Array.BYTES_PER_ELEMENT), n = e[0];
			for (let t = 1; t < e.length; t++) {
				let r = e[t], i = this.fds_map[r] ??= [];
				i.includes(n) || i.push(n);
			}
			return;
		}
		if (e !== Ct.CallUnknownFn) throw TypeError(`unsupported base-call opcode: ${e}`);
		let n = Be(t), r = this.unknown_fn ? await this.unknown_fn(n) : void 0;
		return r === void 0 ? void 0 : Me(r);
	}
	listen_fd(e) {
		return De(this.listen_fd_inner.bind(this, e));
	}
	async listen_fd_inner(t) {
		let n = new Int32Array(this.lock_fds, t * 12), r = t * 72, i = new Uint8Array(this.fd_func_sig, r), a = new Uint16Array(this.fd_func_sig, r), o = new Int32Array(this.fd_func_sig, r), s = new Int32Array(this.fd_func_sig, r), c = new BigUint64Array(this.fd_func_sig, r);
		for (Atomics.store(n, 0, 0), Atomics.store(n, 1, 1), Atomics.store(o, 17, -1);;) {
			let { value: r } = Atomics.waitAsync(n, 1, 1);
			if (await r === "timed-out") throw Error("timed-out");
			let l = (e) => {
				Atomics.store(o, 17, e);
			}, u = Atomics.load(s, 0);
			switch (u) {
				case 7: {
					let e = Atomics.load(s, 1);
					l(this.fd_advise(e));
					break;
				}
				case 8: {
					let e = Atomics.load(s, 1), t = Atomics.load(c, 1), n = Atomics.load(c, 2);
					l(this.fd_allocate(e, t, n));
					break;
				}
				case 9: {
					let e = Atomics.load(s, 1);
					l(await this.fd_close(e));
					break;
				}
				case 10: {
					let e = Atomics.load(s, 1);
					l(this.fd_datasync(e));
					break;
				}
				case 11: {
					let e = Atomics.load(s, 1), [t, n] = this.fd_fdstat_get(e);
					t && (Atomics.store(i, 0, t.fs_filetype), Atomics.store(a, 2, t.fs_flags), Atomics.store(c, 1, t.fs_rights_base), Atomics.store(c, 2, t.fs_rights_inherited)), l(n);
					break;
				}
				case 12: {
					let e = Atomics.load(s, 1), t = Atomics.load(a, 4);
					l(this.fd_fdstat_set_flags(e, t));
					break;
				}
				case 13: {
					let e = Atomics.load(s, 1), t = Atomics.load(c, 1), n = Atomics.load(c, 2);
					l(this.fd_fdstat_set_rights(e, t, n));
					break;
				}
				case 14: {
					let e = Atomics.load(s, 1), [t, n] = this.fd_filestat_get(e);
					t && (Atomics.store(c, 0, t.dev), Atomics.store(c, 1, t.ino), Atomics.store(i, 16, t.filetype), Atomics.store(c, 3, t.nlink), Atomics.store(c, 4, t.size), Atomics.store(c, 5, t.atim), Atomics.store(c, 6, t.mtim), Atomics.store(c, 7, t.ctim)), l(n);
					break;
				}
				case 15: {
					let e = Atomics.load(s, 1), t = Atomics.load(c, 1);
					l(this.fd_filestat_set_size(e, t));
					break;
				}
				case 16: {
					let e = Atomics.load(s, 1), t = Atomics.load(c, 1), n = Atomics.load(c, 2), r = Atomics.load(a, 12);
					l(this.fd_filestat_set_times(e, t, n, r));
					break;
				}
				case 17: {
					let t = Atomics.load(s, 1), n = Atomics.load(s, 2), r = Atomics.load(s, 3), i = Atomics.load(c, 2), a = new Uint32Array(this.allocator.get_memory(n, r));
					this.allocator.free(n, r);
					let o = [];
					for (let t = 0; t < r; t += 8) {
						let n = new e();
						n.buf = a[t * 2], n.buf_len = a[t * 2 + 1], o.push(n);
					}
					let [u, d] = this.fd_pread(t, o, i), [f, p] = u ?? [void 0, void 0];
					f !== void 0 && Atomics.store(s, 0, f), p && await this.allocator.async_write(p, this.fd_func_sig, t * 18 + 1), l(d);
					break;
				}
				case 18: {
					let e = Atomics.load(s, 1), [t, n] = this.fd_prestat_get(e);
					t && (Atomics.store(s, 0, t.tag), Atomics.store(s, 1, t.inner.pr_name.byteLength)), l(n);
					break;
				}
				case 19: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), [n, r] = this.fd_prestat_dir_name(e, t);
					n && (r === 0 || r === 37) && await this.allocator.async_write(n, this.fd_func_sig, e * 18), l(r);
					break;
				}
				case 20: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(c, 2), i = new Uint8Array(this.allocator.get_memory(t, n));
					this.allocator.free(t, n);
					let [a, o] = this.fd_pwrite(e, i, r);
					a !== void 0 && Atomics.store(s, 0, a), l(o);
					break;
				}
				case 21: {
					let t = Atomics.load(s, 1), n = Atomics.load(s, 2), r = Atomics.load(s, 3), i = new Uint32Array(this.allocator.get_memory(n, r));
					this.allocator.free(n, r);
					let a = [];
					for (let t = 0; t < r; t += 8) {
						let n = new e();
						n.buf = i[t * 2], n.buf_len = i[t * 2 + 1], a.push(n);
					}
					let [o, c] = this.fd_read(t, a), [u, d] = o ?? [void 0, void 0];
					u !== void 0 && Atomics.store(s, 0, u), d && await this.allocator.async_write(d, this.fd_func_sig, t * 18 + 1), l(c);
					break;
				}
				case 22: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(c, 2), [r, i] = this.fd_readdir(e, t, n), [a, o] = r ?? [void 0, void 0];
					a && await this.allocator.async_write(a, this.fd_func_sig, e * 18), o !== void 0 && Atomics.store(s, 2, o), l(i);
					break;
				}
				case 24: {
					let e = Atomics.load(s, 1), t = Atomics.load(c, 1), n = Atomics.load(i, 16), [r, a] = this.fd_seek(e, t, n);
					r !== void 0 && Atomics.store(c, 0, r), l(a);
					break;
				}
				case 25: {
					let e = Atomics.load(s, 1);
					l(this.fd_sync(e));
					break;
				}
				case 26: {
					let e = Atomics.load(s, 1), [t, n] = this.fd_tell(e);
					t !== void 0 && Atomics.store(c, 0, t), l(n);
					break;
				}
				case 27: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = new Uint8Array(this.allocator.get_memory(t, n));
					this.allocator.free(t, n);
					let [i, a] = await this.fd_write(e, r);
					i !== void 0 && Atomics.store(s, 0, i), l(a);
					break;
				}
				case 28: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = new Uint8Array(this.allocator.get_memory(t, n)), i = new TextDecoder().decode(r);
					this.allocator.free(t, n), l(this.path_create_directory(e, i));
					break;
				}
				case 29: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), a = new Uint8Array(this.allocator.get_memory(n, r)), o = new TextDecoder().decode(a);
					this.allocator.free(n, r);
					let [u, d] = this.path_filestat_get(e, t, o);
					u && (Atomics.store(c, 0, u.dev), Atomics.store(c, 1, u.ino), Atomics.store(i, 16, u.filetype), Atomics.store(c, 3, u.nlink), Atomics.store(c, 4, u.size), Atomics.store(c, 5, u.atim), Atomics.store(c, 6, u.mtim), Atomics.store(c, 7, u.ctim)), l(d);
					break;
				}
				case 30: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = Atomics.load(c, 3), o = Atomics.load(c, 4), u = Atomics.load(a, 12), d = new Uint8Array(this.allocator.get_memory(n, r)), f = new TextDecoder().decode(d);
					this.allocator.free(n, r), l(this.path_filestat_set_times(e, t, f, i, o, u));
					break;
				}
				case 31: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = Atomics.load(s, 5), a = Atomics.load(s, 6), o = Atomics.load(s, 7), c = new Uint8Array(this.allocator.get_memory(n, r)), u = new TextDecoder().decode(c);
					this.allocator.free(n, r);
					let d = new Uint8Array(this.allocator.get_memory(a, o)), f = new TextDecoder().decode(d);
					this.allocator.free(a, o), l(this.path_link(e, t, u, i, f));
					break;
				}
				case 32: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = Atomics.load(s, 5), o = Atomics.load(c, 3), u = Atomics.load(c, 4), d = Atomics.load(a, 20), f = new Uint8Array(this.allocator.get_memory(n, r)), p = new TextDecoder().decode(f);
					this.allocator.free(n, r);
					let [m, h] = await this.path_open(e, t, p, i, o, u, d);
					m !== void 0 && Atomics.store(s, 0, m), l(h);
					break;
				}
				case 33: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = new Uint8Array(this.allocator.get_memory(t, n)), a = new TextDecoder().decode(i);
					this.allocator.free(t, n);
					let [o, c] = this.path_readlink(e, a, r);
					o && (await this.allocator.async_write(o, this.fd_func_sig, e * 18 + 1), Atomics.store(s, 0, o.byteLength)), l(c);
					break;
				}
				case 34: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = new Uint8Array(this.allocator.get_memory(t, n)), i = new TextDecoder().decode(r);
					this.allocator.free(t, n), l(this.path_remove_directory(e, i));
					break;
				}
				case 35: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = Atomics.load(s, 5), a = Atomics.load(s, 6), o = new Uint8Array(this.allocator.get_memory(t, n)), c = new TextDecoder().decode(o);
					this.allocator.free(t, n);
					let u = new Uint8Array(this.allocator.get_memory(i, a)), d = new TextDecoder().decode(u);
					this.allocator.free(i, a), l(this.path_rename(e, c, r, d));
					break;
				}
				case 36: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = Atomics.load(s, 4), i = Atomics.load(s, 5), a = new Uint8Array(this.allocator.get_memory(e, t)), o = new TextDecoder().decode(a);
					this.allocator.free(e, t);
					let c = new Uint8Array(this.allocator.get_memory(r, i)), u = new TextDecoder().decode(c);
					this.allocator.free(r, i), l(this.path_symlink(o, n, u));
					break;
				}
				case 37: {
					let e = Atomics.load(s, 1), t = Atomics.load(s, 2), n = Atomics.load(s, 3), r = new Uint8Array(this.allocator.get_memory(t, n)), i = new TextDecoder().decode(r);
					this.allocator.free(t, n), l(this.path_unlink_file(e, i));
					break;
				}
				default: throw Error(`Unknown function number: ${u}`);
			}
			Atomics.store(n, 1, 1), Atomics.store(n, 2, 0);
			let d = Atomics.notify(n, 2);
			if (d !== 1 && console.warn(d === 0 ? "notify number is 0. ref is late?" : `notify number is not 1: ${d}`), this.fds[t] === void 0) break;
		}
	}
};
//#endregion
//#region src/patch.ts
function Lt(e, t, n, i, a, o, s, c) {
	let l = new r(t, n, a);
	return l.dev = e, l.ino = t, l.filetype = n, l.nlink = i, l.size = a, l.atim = o, l.mtim = s, l.ctim = c, l;
}
//#endregion
//#region src/ref.ts
var Rt = class {
	stdin;
	stdout;
	stderr;
	id;
	fd_close_receiver;
	default_fds = [];
	async send(e, t) {
		await this.fd_close_receiver.send(e, t);
	}
	get(e) {
		return this.fd_close_receiver.get(e);
	}
	constructor(e, t, n, r, i) {
		this.stdin = e, this.stdout = t, this.stderr = n, this.fd_close_receiver = r, i !== void 0 && (this.default_fds = i);
	}
	get_stdin() {
		return this.stdin;
	}
	get_stdout() {
		return this.stdout;
	}
	get_stderr() {
		return this.stderr;
	}
}, zt = class e extends Rt {
	allocator;
	lock_fds;
	fds_len_and_num;
	fd_func_sig;
	baseCall;
	constructor(e, t, n, r, i, a, o, s, c, l) {
		super(o, s, c, Ee.init_self(a), l), this.allocator = u.init_self(e), this.lock_fds = t, this.fd_func_sig = r, this.baseCall = Et.init_self(i), this.fds_len_and_num = n;
	}
	get_fds_len() {
		let e = new Int32Array(this.fds_len_and_num);
		return Atomics.load(e, 0);
	}
	static init_self(t) {
		return new e(t.allocator, t.lock_fds, t.fds_len_and_num, t.fd_func_sig, t.baseCall, t.fd_close_receiver, t.stdin, t.stdout, t.stderr, t.default_fds);
	}
	set_id() {
		let e = new Int32Array(this.fds_len_and_num), t = Atomics.add(e, 1, 1);
		return this.id = t, t;
	}
	set_park_fds_map(e) {
		let t = new Uint32Array([this.id, ...e]), n = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
		this.baseCall.block_call(Ct.SetParkFdsMap, n);
	}
	destroy_park() {
		this.baseCall.block_call(Ct.DestroyPark, new Uint8Array());
	}
	call_unknown_fn(e) {
		let t = Me(e), n = this.baseCall.block_call(Ct.CallUnknownFn, t);
		return n === void 0 ? void 0 : Be(n);
	}
	key = Math.round(Math.random() * 100);
	lock_fd(e) {
		let t = new Int32Array(this.lock_fds, e * 12);
		for (;;) {
			let e = Atomics.load(t, 0);
			if (e !== 0 && Atomics.wait(t, 0, e) === "timed-out") {
				console.error("lock_fd timed-out");
				continue;
			}
			if (Atomics.compareExchange(t, 0, 0, 1) === 0) return;
		}
	}
	release_fd(e) {
		let t = new Int32Array(this.lock_fds, e * 12), n = Atomics.exchange(t, 0, 0);
		n !== 1 && console.error("what happened? before", n), Atomics.notify(t, 0, 1);
	}
	lock_double_fd(e, t) {
		if (e === t) {
			this.lock_fd(e);
			return;
		}
		let n = new Int32Array(this.lock_fds);
		for (;;) {
			let r = Atomics.load(n, e * 3);
			if (Atomics.wait(n, e * 3, r) === "timed-out") {
				console.error("lock_double_fd timed-out");
				continue;
			}
			if (Atomics.exchange(n, e * 3, 2) === 0) {
				let r = Atomics.load(n, t * 3);
				if (r === 2 && e < t) {
					Atomics.store(n, e * 3, 0), Atomics.notify(n, e * 3, 1);
					continue;
				}
				if (Atomics.wait(n, t * 3, r) === "timed-out") {
					console.error("lock_double_fd timed-out");
					continue;
				}
				if (Atomics.exchange(n, t * 3, 2) === 0) return;
				Atomics.store(n, e * 3, 0), Atomics.notify(n, e * 3, 1);
			}
		}
	}
	release_double_fd(e, t) {
		if (e === t) {
			this.release_fd(e);
			return;
		}
		let n = new Int32Array(this.lock_fds);
		Atomics.store(n, e * 3, 0), Atomics.notify(n, e * 3, 1), Atomics.store(n, t * 3, 0), Atomics.notify(n, t * 3, 1);
	}
	invoke_fd_func(e) {
		if (e === void 0) return !1;
		let t = new Int32Array(this.lock_fds, e * 12);
		Atomics.store(t, 2, 1), Atomics.store(t, 1, 0);
		let n = Atomics.notify(t, 1);
		return n === 1 ? !0 : n === 0 ? this.get_fds_len() <= e ? (console.error("invoke_fd_func notify len failed:", n), Atomics.store(t, 2, 0), Atomics.store(t, 1, 1), !1) : (console.warn("invoke_func_loop is late"), !0) : (console.error("invoke_fd_func notify too:", n), !1);
	}
	wait_fd_func(e) {
		let t = new Int32Array(this.lock_fds, e * 12);
		Atomics.wait(t, 2, 1) === "timed-out" && console.error("wait call park_fd_func timed-out");
	}
	call_fd_func(e) {
		return this.invoke_fd_func(e) ? (this.wait_fd_func(e), !0) : !1;
	}
	get_error(e) {
		let t = new Int32Array(this.fd_func_sig, e * 72);
		return Atomics.load(t, 17);
	}
	fd_advise(e) {
		this.lock_fd(e);
		let t = new Uint32Array(this.fd_func_sig, e * 72);
		if (Atomics.store(t, 0, 7), Atomics.store(t, 1, e), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let n = this.get_error(e);
		return this.release_fd(e), n;
	}
	fd_allocate(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r), a = new BigUint64Array(this.fd_func_sig, r);
		if (Atomics.store(i, 0, 8), Atomics.store(i, 1, e), Atomics.store(a, 1, t), Atomics.store(a, 2, n), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let o = this.get_error(e);
		return this.release_fd(e), o;
	}
	fd_close(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint32Array(this.fd_func_sig, t);
		if (Atomics.store(n, 0, 9), Atomics.store(n, 1, e), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let r = this.get_error(e);
		return this.release_fd(e), r;
	}
	fd_datasync(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint32Array(this.fd_func_sig, t);
		if (Atomics.store(n, 0, 10), Atomics.store(n, 1, e), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let r = this.get_error(e);
		return this.release_fd(e), r;
	}
	fd_fdstat_get(e) {
		this.lock_fd(e);
		let t = e * 72, r = new Uint8Array(this.fd_func_sig, t), i = new Uint16Array(this.fd_func_sig, t), a = new Uint32Array(this.fd_func_sig, t), o = new BigUint64Array(this.fd_func_sig, t);
		if (Atomics.store(a, 0, 11), Atomics.store(a, 1, e), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let s = this.get_error(e);
		if (s !== 0) return this.release_fd(e), [void 0, s];
		let c = Atomics.load(r, 0), l = Atomics.load(i, 2), u = Atomics.load(o, 1), d = Atomics.load(o, 2);
		this.release_fd(e);
		let f = new n(c, l);
		return f.fs_rights_base = u, f.fs_rights_inherited = d, [f, s];
	}
	fd_fdstat_set_flags(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint16Array(this.fd_func_sig, n), i = new Uint32Array(this.fd_func_sig, n);
		if (Atomics.store(i, 0, 12), Atomics.store(i, 1, e), Atomics.store(r, 4, t), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let a = this.get_error(e);
		return this.release_fd(e), a;
	}
	fd_fdstat_set_rights(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r), a = new BigUint64Array(this.fd_func_sig, r);
		if (Atomics.store(i, 0, 13), Atomics.store(i, 1, e), Atomics.store(a, 1, t), Atomics.store(a, 2, n), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let o = this.get_error(e);
		return this.release_fd(e), o;
	}
	fd_filestat_get(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint8Array(this.fd_func_sig, t), r = new Uint32Array(this.fd_func_sig, t), i = new BigUint64Array(this.fd_func_sig, t);
		if (Atomics.store(r, 0, 14), Atomics.store(r, 1, e), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let a = this.get_error(e);
		if (a !== 0) return this.release_fd(e), [void 0, a];
		let o = Atomics.load(i, 0), s = Atomics.load(i, 1), c = Atomics.load(n, 16), l = Atomics.load(i, 3), u = Atomics.load(i, 4), d = Atomics.load(i, 5), f = Atomics.load(i, 6), p = Atomics.load(i, 7);
		return this.release_fd(e), [Lt(o, s, c, l, u, d, f, p), a];
	}
	fd_filestat_set_size(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n), i = new BigUint64Array(this.fd_func_sig, n);
		if (Atomics.store(r, 0, 15), Atomics.store(r, 1, e), Atomics.store(i, 1, t), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let a = this.get_error(e);
		return this.release_fd(e), a;
	}
	fd_filestat_set_times(e, t, n, r) {
		this.lock_fd(e);
		let i = e * 72, a = new Uint16Array(this.fd_func_sig, i), o = new Uint32Array(this.fd_func_sig, i), s = new BigUint64Array(this.fd_func_sig, i);
		if (Atomics.store(o, 0, 16), Atomics.store(o, 1, e), Atomics.store(s, 1, t), Atomics.store(s, 2, n), Atomics.store(a, 12, r), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let c = this.get_error(e);
		return this.release_fd(e), c;
	}
	fd_pread(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r), a = new BigUint64Array(this.fd_func_sig, r);
		Atomics.store(i, 0, 17), Atomics.store(i, 1, e);
		let [o, s] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (Atomics.store(a, 2, n), !this.call_fd_func(e)) return this.allocator.free(o, s), this.release_fd(e), [void 0, 8];
		let c = this.get_error(e), l = Atomics.load(i, 0), u = Atomics.load(i, 1), d = Atomics.load(i, 2);
		if (this.release_fd(e), c === 8) return this.allocator.free(u, d), [void 0, c];
		let f = new Uint8Array(this.allocator.get_memory(u, d));
		return l !== d && console.error("pread nread !== buf_len"), this.allocator.free(u, d), [[l, f], c];
	}
	fd_prestat_get(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint32Array(this.fd_func_sig, t);
		if (Atomics.store(n, 0, 18), Atomics.store(n, 1, e), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let r = this.get_error(e);
		if (r !== 0) return this.release_fd(e), [void 0, r];
		let i = Atomics.load(n, 0), a = Atomics.load(n, 1);
		return this.release_fd(e), [[i, a], r];
	}
	fd_prestat_dir_name(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		if (Atomics.store(r, 0, 19), Atomics.store(r, 1, e), Atomics.store(r, 2, t), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let i = this.get_error(e), a = Atomics.load(r, 0), o = Atomics.load(r, 1);
		if (this.release_fd(e), i !== 0 && i !== 37) return this.allocator.free(a, o), [void 0, i];
		let s = new Uint8Array(this.allocator.get_memory(a, o));
		return this.allocator.free(a, o), [s, i];
	}
	fd_pwrite(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r), a = new BigUint64Array(this.fd_func_sig, r);
		Atomics.store(i, 0, 20), Atomics.store(i, 1, e);
		let [o, s] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (Atomics.store(a, 2, n), !this.call_fd_func(e)) return this.allocator.free(o, s), this.release_fd(e), [void 0, 8];
		let c = this.get_error(e);
		if (c === 8) return this.release_fd(e), [void 0, c];
		let l = Atomics.load(i, 0);
		return this.release_fd(e), [l, c];
	}
	fd_read(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		Atomics.store(r, 0, 21), Atomics.store(r, 1, e);
		let [i, a] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (!this.call_fd_func(e)) return this.allocator.free(i, a), this.release_fd(e), [void 0, 8];
		let o = this.get_error(e), s = Atomics.load(r, 0), c = Atomics.load(r, 1), l = Atomics.load(r, 2);
		if (this.release_fd(e), o === 8) return this.allocator.free(c, l), [void 0, o];
		let u = new Uint8Array(this.allocator.get_memory(c, l));
		return s !== l && console.error("read nread !== buf_len"), this.allocator.free(c, l), [[s, u], o];
	}
	fd_readdir(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r), a = new BigUint64Array(this.fd_func_sig, r);
		if (Atomics.store(i, 0, 22), Atomics.store(i, 1, e), Atomics.store(i, 2, t), Atomics.store(a, 2, n), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let o = this.get_error(e), s = Atomics.load(i, 0), c = Atomics.load(i, 1), l = Atomics.load(i, 2);
		if (this.release_fd(e), o === 8) return this.allocator.free(s, c), [void 0, o];
		let u = new Uint8Array(this.allocator.get_memory(s, c));
		return this.allocator.free(s, c), [[u, l], o];
	}
	fd_seek(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint8Array(this.fd_func_sig, r), a = new Uint32Array(this.fd_func_sig, r), o = new BigUint64Array(this.fd_func_sig, r);
		if (Atomics.store(a, 0, 24), Atomics.store(a, 1, e), Atomics.store(o, 1, t), Atomics.store(i, 16, n), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let s = this.get_error(e);
		if (s === 8) return this.release_fd(e), [void 0, s];
		let c = Atomics.load(o, 0);
		return this.release_fd(e), [c, s];
	}
	fd_sync(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint32Array(this.fd_func_sig, t);
		if (Atomics.store(n, 0, 25), Atomics.store(n, 1, e), !this.call_fd_func(e)) return this.release_fd(e), 8;
		let r = this.get_error(e);
		return this.release_fd(e), r;
	}
	fd_tell(e) {
		this.lock_fd(e);
		let t = e * 72, n = new Uint32Array(this.fd_func_sig, t), r = new BigUint64Array(this.fd_func_sig, t);
		if (Atomics.store(n, 0, 26), Atomics.store(n, 1, e), !this.call_fd_func(e)) return this.release_fd(e), [void 0, 8];
		let i = this.get_error(e);
		if (i === 8) return this.release_fd(e), [void 0, i];
		let a = Atomics.load(r, 0);
		return this.release_fd(e), [a, i];
	}
	fd_write(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		Atomics.store(r, 0, 27), Atomics.store(r, 1, e);
		let [i, a] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (!this.call_fd_func(e)) return this.allocator.free(i, a), this.release_fd(e), [void 0, 8];
		let o = this.get_error(e);
		if (o === 8) return this.release_fd(e), [void 0, o];
		let s = Atomics.load(r, 0);
		return this.release_fd(e), [s, o];
	}
	path_create_directory(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		Atomics.store(r, 0, 28), Atomics.store(r, 1, e);
		let [i, a] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (!this.call_fd_func(e)) return this.allocator.free(i, a), this.release_fd(e), 8;
		let o = this.get_error(e);
		return this.release_fd(e), o;
	}
	path_filestat_get(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint8Array(this.fd_func_sig, r), a = new Uint32Array(this.fd_func_sig, r), o = new BigUint64Array(this.fd_func_sig, r);
		Atomics.store(a, 0, 29), Atomics.store(a, 1, e), Atomics.store(a, 2, t);
		let [s, c] = this.allocator.block_write(n, this.fd_func_sig, e * 18 + 3);
		if (!this.call_fd_func(e)) return this.allocator.free(s, c), this.release_fd(e), [void 0, 8];
		let l = this.get_error(e);
		if (l !== 0) return this.release_fd(e), [void 0, l];
		let u = Atomics.load(o, 0), d = Atomics.load(o, 1), f = Atomics.load(i, 16), p = Atomics.load(o, 3), m = Atomics.load(o, 4), h = Atomics.load(o, 5), g = Atomics.load(o, 6), _ = Atomics.load(o, 7);
		return this.release_fd(e), [Lt(u, d, f, p, m, h, g, _), l];
	}
	path_filestat_set_times(e, t, n, r, i, a) {
		this.lock_fd(e);
		let o = e * 72, s = new Uint16Array(this.fd_func_sig, o), c = new Uint32Array(this.fd_func_sig, o), l = new BigUint64Array(this.fd_func_sig, o);
		Atomics.store(c, 0, 30), Atomics.store(c, 1, e), Atomics.store(c, 2, t);
		let [u, d] = this.allocator.block_write(n, this.fd_func_sig, e * 18 + 3);
		if (Atomics.store(l, 3, r), Atomics.store(l, 4, i), Atomics.store(s, 12, a), !this.call_fd_func(e)) return this.allocator.free(u, d), this.release_fd(e), 8;
		let f = this.get_error(e);
		return this.release_fd(e), f;
	}
	path_link(e, t, n, r, i) {
		this.lock_double_fd(e, r);
		let a = e * 72, o = new Uint32Array(this.fd_func_sig, a);
		Atomics.store(o, 0, 31), Atomics.store(o, 1, e), Atomics.store(o, 2, t);
		let [s, c] = this.allocator.block_write(n, this.fd_func_sig, e * 18 + 3);
		Atomics.store(o, 5, r);
		let [l, u] = this.allocator.block_write(i, this.fd_func_sig, e * 18 + 6);
		if (!this.call_fd_func(e)) return this.allocator.free(s, c), this.allocator.free(l, u), this.release_double_fd(e, r), 8;
		let d = this.get_error(e);
		return this.release_double_fd(e, r), d;
	}
	path_open(e, t, n, r, i, a, o) {
		this.lock_fd(e);
		let s = e * 72, c = new Uint16Array(this.fd_func_sig, s), l = new Uint32Array(this.fd_func_sig, s), u = new BigUint64Array(this.fd_func_sig, s);
		Atomics.store(l, 0, 32), Atomics.store(l, 1, e), Atomics.store(l, 2, t);
		let [d, f] = this.allocator.block_write(n, this.fd_func_sig, e * 18 + 3);
		if (Atomics.store(l, 5, r), Atomics.store(u, 3, i), Atomics.store(u, 4, a), Atomics.store(c, 20, o), !this.call_fd_func(e)) return this.allocator.free(d, f), this.release_fd(e), [void 0, 8];
		let p = this.get_error(e);
		if (p === 0) {
			let t = Atomics.load(l, 0);
			return this.release_fd(e), [t, p];
		}
		return this.release_fd(e), [void 0, p];
	}
	path_readlink(e, t, n) {
		this.lock_fd(e);
		let r = e * 72, i = new Uint32Array(this.fd_func_sig, r);
		Atomics.store(i, 0, 33), Atomics.store(i, 1, e);
		let [a, o] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (Atomics.store(i, 4, n), !this.call_fd_func(e)) return this.allocator.free(a, o), this.release_fd(e), [void 0, 8];
		let s = this.get_error(e), c = Atomics.load(i, 0), l = Atomics.load(i, 1), u = Atomics.load(i, 2);
		return this.release_fd(e), s !== 0 && s !== 37 ? (this.allocator.free(l, u), [void 0, s]) : [new Uint8Array(this.allocator.get_memory(l, u)).slice(0, c), s];
	}
	path_remove_directory(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		Atomics.store(r, 0, 34), Atomics.store(r, 1, e);
		let [i, a] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (!this.call_fd_func(e)) return this.allocator.free(i, a), this.release_fd(e), 8;
		let o = this.get_error(e);
		return this.release_fd(e), o;
	}
	path_rename(e, t, n, r) {
		this.lock_double_fd(e, n);
		let i = e * 72, a = new Uint32Array(this.fd_func_sig, i);
		Atomics.store(a, 0, 35), Atomics.store(a, 1, e);
		let [o, s] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		Atomics.store(a, 4, n);
		let [c, l] = this.allocator.block_write(r, this.fd_func_sig, e * 18 + 5);
		if (!this.call_fd_func(e)) return this.allocator.free(o, s), this.allocator.free(c, l), this.release_double_fd(e, n), 8;
		let u = this.get_error(e);
		return this.release_double_fd(e, n), u;
	}
	path_symlink(e, t, n) {
		this.lock_fd(t);
		let r = t * 72, i = new Uint32Array(this.fd_func_sig, r);
		Atomics.store(i, 0, 36);
		let [a, o] = this.allocator.block_write(e, this.fd_func_sig, t * 18 + 1);
		Atomics.store(i, 3, t);
		let [s, c] = this.allocator.block_write(n, this.fd_func_sig, t * 18 + 4);
		if (!this.call_fd_func(t)) return this.allocator.free(a, o), this.allocator.free(s, c), this.release_fd(t), 8;
		let l = this.get_error(t);
		return this.release_fd(t), l;
	}
	path_unlink_file(e, t) {
		this.lock_fd(e);
		let n = e * 72, r = new Uint32Array(this.fd_func_sig, n);
		Atomics.store(r, 0, 37), Atomics.store(r, 1, e);
		let [i, a] = this.allocator.block_write(t, this.fd_func_sig, e * 18 + 2);
		if (!this.call_fd_func(e)) return this.allocator.free(i, a), this.release_fd(e), 8;
		let o = this.get_error(e);
		return this.release_fd(e), o;
	}
};
//#endregion
//#region src/shared_array_buffer/thread_spawn.ts
function Bt(e) {
	return e instanceof Error || typeof e == "object" && e && "message" in e && typeof e.message == "string" ? e.message : String(e);
}
var Vt = class e {
	share_memory;
	wasi_farm_refs_object;
	worker_url;
	worker_background_ref;
	worker_background_ref_object;
	destroy_status;
	animal_id_counter;
	worker_background_worker;
	worker_background_worker_promise = Promise.resolve();
	worker_background_ready = !1;
	worker_background_ready_settled = !1;
	worker_background_readiness_error;
	reject_worker_background_worker;
	destroy_promise;
	destroyer_handles = /* @__PURE__ */ new Map();
	coordinator_failure;
	owns_worker_background_worker;
	constructor(e, t, n, r = 16777216, i, a, o, s, c) {
		if (this.owns_worker_background_worker = i === void 0, this.worker_url = e, this.wasi_farm_refs_object = t, this.destroy_status = i?.destroy_status ?? s ?? ee(), this.animal_id_counter = c ?? new SharedArrayBuffer(4), n === void 0) {
			let e = r / 65536;
			if (e < 16) throw Error("The stack size must be at least 16 bytes.");
			this.share_memory = { memory: new WebAssembly.Memory({
				initial: e,
				maximum: 16384,
				shared: !0
			}) };
		} else this.share_memory = n;
		if (this.worker_background_ref_object = i ?? ye(this.destroy_status), this.worker_background_ref = be.init_self(this.worker_background_ref_object), this.owns_worker_background_worker) {
			let e;
			e = o || Se();
			let t = !1, n = () => {
				o === void 0 && !t && (t = !0, URL.revokeObjectURL(e));
			}, { promise: r, resolve: i, reject: s } = Promise.withResolvers();
			this.worker_background_worker_promise = r, this.reject_worker_background_worker = s, r.catch(() => void 0);
			let c = (e) => {
				n();
				let t = new Int32Array(this.destroy_status), r = y(t);
				if (r === h.Destroyed || r === h.Failed || this.coordinator_failure !== void 0) return;
				let i = this.worker_background_ready ? g.CoordinatorRuntime : g.CoordinatorBootstrap, a = new _(i);
				a.cause = Error(Bt(e)), this.coordinator_failure = a;
				let o = this.worker_background_worker;
				o !== void 0 && (this.worker_background_worker = void 0, o.onmessage = null, o.onerror = null, o.onmessageerror = null, o.terminate()), this.worker_background_ready_settled || (this.worker_background_ready_settled = !0, this.worker_background_readiness_error = a, s(a)), b(t), this.start_destroy_finalization(), this.worker_background_ref.recover_failed_coordinator_command().catch((e) => console.error(e)).finally(() => {
					C(t, i), this.worker_background_ref.cancel_runtime_completion();
				});
			}, l;
			try {
				l = new Worker(e, { type: "module" }), this.worker_background_worker = l;
			} catch (e) {
				c(e);
				return;
			}
			l.onmessage = (e) => {
				if (n(), y(new Int32Array(this.destroy_status)) === h.Running) {
					if (!this.worker_background_ready) {
						if (e.data !== "ready") {
							c(/* @__PURE__ */ Error("invalid coordinator ready message"));
							return;
						}
						this.worker_background_ready = !0, this.worker_background_ready_settled = !0, this.reject_worker_background_worker = void 0, i();
						return;
					}
					c(/* @__PURE__ */ Error("unexpected coordinator message"));
				}
			}, l.onerror = (e) => {
				e.preventDefault(), c(e.error ?? Error(e.message));
			}, l.onmessageerror = () => {
				c(/* @__PURE__ */ Error("coordinator message could not be decoded"));
			};
			try {
				let { destroy_status: e, worker_background_ref_object: t, ...n } = this.get_object();
				l.postMessage({
					override_object: {
						sl_object: n,
						thread_spawn_wasm: a
					},
					worker_background_ref_object: this.worker_background_ref.get_object()
				});
			} catch (e) {
				c(e);
			}
			this.observe_destroy().finally(n).catch((e) => console.error(e));
		} else this.worker_background_ready = !0, this.worker_background_ready_settled = !0;
	}
	wait_worker_background_worker() {
		return this.worker_background_worker_promise;
	}
	check_worker_background_worker() {
		if (this.worker_background_readiness_error !== void 0) throw this.worker_background_readiness_error;
		if (!this.worker_background_ready) throw Error("worker_background_worker is not ready.");
	}
	thread_spawn(e, t, n, r) {
		return this.worker_background_ref.new_worker(this.worker_url, { type: "module" }, {
			this_is_thread_spawn: !0,
			start_arg: e,
			args: t,
			env: n,
			fd_map: r
		}).get_id();
	}
	create_destroyer(e) {
		let t = this.is_managed_worker_context() ? e : void 0, n = this.destroyer_handles.get(t);
		return n === void 0 && (n = new Ce(this.worker_background_ref, this.destroy_status, t), this.destroyer_handles.set(t, n)), n;
	}
	is_managed_worker_context() {
		return !this.owns_worker_background_worker;
	}
	generate_animal_id() {
		let e = new Int32Array(this.animal_id_counter);
		return Atomics.add(e, 0, 1);
	}
	async async_start_on_thread(e, t, n) {
		if (!self.Worker.toString().includes("[native code]")) if (self.Worker.toString().includes("function")) console.warn("SubWorker(new Worker on Worker) is polyfilled maybe.");
		else throw Error("SubWorker(new Worker on Worker) is not supported.");
		await this.worker_background_ref.async_start_on_thread(this.worker_url, { type: "module" }, {
			this_is_thread_spawn: !0,
			this_is_start: !0,
			args: e,
			env: t,
			fd_map: n
		});
	}
	block_start_on_thread(e, t, n) {
		if (!self.Worker.toString().includes("[native code]")) if (self.Worker.toString().includes("function")) console.warn("SubWorker(new Worker on Worker) is polyfilled maybe.");
		else throw Error("SubWorker(new Worker on Worker) is not supported.");
		this.worker_background_ref.block_start_on_thread(this.worker_url, { type: "module" }, {
			this_is_thread_spawn: !0,
			this_is_start: !0,
			args: e,
			env: t,
			fd_map: n
		});
	}
	static init_self(t) {
		return new e(t.worker_url, t.wasi_farm_refs_object, t.share_memory, void 0, t.worker_background_ref_object, void 0, void 0, t.destroy_status, t.animal_id_counter);
	}
	static init_self_with_worker_background_ref(t, n) {
		return new e(t.worker_url, t.wasi_farm_refs_object, t.share_memory, void 0, n, void 0, void 0, t.destroy_status, t.animal_id_counter);
	}
	get_share_memory() {
		return this.share_memory;
	}
	get_object() {
		return {
			share_memory: this.share_memory,
			wasi_farm_refs_object: this.wasi_farm_refs_object,
			worker_url: this.worker_url,
			worker_background_ref_object: this.worker_background_ref_object,
			destroy_status: this.destroy_status,
			animal_id_counter: this.animal_id_counter
		};
	}
	done_notify(e) {
		this.worker_background_ref.done_notify(e, this.owns_worker_background_worker);
	}
	async async_wait_done_or_error() {
		if (this.worker_background_worker === void 0) throw Error("worker_background_worker is undefined.");
		return await this.worker_background_ref.async_wait_done_or_error();
	}
	block_wait_done_or_error() {
		if (this.worker_background_worker === void 0) throw Error("worker_background_worker is undefined.");
		return this.worker_background_ref.block_wait_done_or_error();
	}
	destroy(e) {
		if (!this.owns_worker_background_worker) {
			this.create_destroyer(e).destroy();
			return;
		}
		if (b(new Int32Array(this.destroy_status), this.is_managed_worker_context() ? e : void 0) && this.worker_background_ref.notify_destroy(), !this.worker_background_ready_settled) {
			let e = new _(g.Protocol);
			this.worker_background_ready_settled = !0, this.worker_background_readiness_error = e, this.reject_worker_background_worker?.(e), this.reject_worker_background_worker = void 0;
		}
		this.start_destroy_finalization();
	}
	async_destroy(e) {
		return this.owns_worker_background_worker ? (this.destroy(e), this.destroy_promise) : this.create_destroyer(e).async_destroy();
	}
	start_destroy_finalization() {
		return this.destroy_promise ??= this.finish_destroy(), this.destroy_promise.catch(() => void 0), this.destroy_promise;
	}
	async observe_destroy() {
		let e = new Int32Array(this.destroy_status);
		for (;;) {
			let t = Atomics.load(e, 3);
			if (y(e) !== h.Running) {
				this.destroy(), await this.start_destroy_finalization().catch(() => void 0);
				return;
			}
			let { value: n } = Atomics.waitAsync(e, 3, t);
			n instanceof Promise && await n;
		}
	}
	async finish_destroy() {
		let e = this.worker_background_worker;
		try {
			await ie(new Int32Array(this.destroy_status));
		} finally {
			e !== void 0 && this.worker_background_worker === e && (e.onmessage = null, e.onerror = null, e.onmessageerror = null, e.terminate(), this.worker_background_worker = void 0);
		}
	}
	kill_animal(e) {
		this.worker_background_ref.kill_animal(e);
	}
}, Ht = async (e, t = WebAssembly.instantiate.bind(WebAssembly), n = () => {}) => {
	if (e.this_is_thread_spawn) {
		let { sl_object: r, fd_map: i, worker_background_ref: a, thread_spawn_wasm: o, args: s, env: c } = e, l = Array(r.wasi_farm_refs_object.length);
		for (let e of i) {
			if (e == null) continue;
			let [t, n] = e;
			l[n] === void 0 && (l[n] = []), l[n].push(t);
		}
		let u = Vt.init_self_with_worker_background_ref(r, a), { animal_id: d } = e, f;
		try {
			f = new Gt(r.wasi_farm_refs_object, s, c, {
				can_thread_spawn: !0,
				thread_spawn_worker_url: r.worker_url,
				hand_override_fd_map: i
			}, l, u, d), await n(f);
		} catch (e) {
			Wt(e, d, "animal-construction");
			return;
		}
		let p;
		try {
			p = await t(o, {
				env: { ...f.get_share_memory() },
				wasi: f.wasiThreadImport,
				wasi_snapshot_preview1: f.wasiImport
			});
		} catch (e) {
			Wt(e, d, "wasm-instantiation");
			return;
		}
		if (globalThis.postMessage({
			msg: "ready",
			animal_id: d
		}), e.this_is_start) {
			try {
				f.start_only(p);
			} catch (e) {
				return Ut(e, "main", d), f;
			}
			return globalThis.postMessage({
				msg: "done",
				animal_id: d
			}), f;
		}
		let { worker_id: m, start_arg: h } = e;
		console.debug(`thread_spawn worker ${m} start`);
		try {
			f.wasi_thread_start(p, m, h);
		} catch (e) {
			return Ut(e, m, d), f;
		}
		return globalThis.postMessage({
			msg: "done",
			animal_id: d
		}), f;
	}
};
function Ut(e, t, n) {
	if (e instanceof c) {
		globalThis.postMessage({
			msg: "exit",
			animal_id: n,
			code: e.code
		});
		return;
	}
	Wt(e, n, void 0, t);
}
function Wt(e, t, n, r = "startup") {
	let i = e;
	try {
		structuredClone(e);
	} catch (t) {
		if (t.name === "DataCloneError") {
			let t = /* @__PURE__ */ Error(`An error occurred on the thread ${r}, but it cannot be cloned.
                Since error propagation does not work properly with this,
                stopping cannot be performed.
                Therefore, I will insert this error instead.
                The error currently confirmed occurs in Firefox,
                after executing with invoke on webworker and reaching an unreachable statement.
                `);
			t.name = "EncounteredUncloneableError", t.stack = e.stack, i = t;
		}
	}
	globalThis.postMessage({
		msg: "error",
		animal_id: t,
		error: i,
		...n === void 0 ? {} : { stage: n }
	});
}
//#endregion
//#region src/animals.ts
var Gt = class {
	args;
	env;
	wasi_farm_refs;
	id_in_wasi_farm_ref;
	inst;
	wasiImport;
	wasiThreadImport;
	animal_id;
	can_array_buffer;
	sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
	can_thread_spawn;
	thread_spawner;
	destroy_promise;
	async wait_worker_background_worker() {
		await this.thread_spawner?.wait_worker_background_worker();
	}
	check_worker_background_worker() {
		this.thread_spawner?.check_worker_background_worker();
	}
	fd_map = [];
	get_fd_and_wasi_ref(e) {
		let t = this.fd_map[e];
		if (!t) return [void 0, void 0];
		let [n, r] = t;
		return [n, this.wasi_farm_refs[r]];
	}
	get_fd_and_wasi_ref_n(e) {
		let t = this.fd_map[e];
		if (!t) return [void 0, void 0];
		let [n, r] = t;
		return [n, r];
	}
	start(e) {
		this.inst = e;
		try {
			if (e.exports._start(), this.can_thread_spawn) {
				if (!this.thread_spawner) throw Error("You should enable thread_spawn to use create_destroyer");
				this.thread_spawner.done_notify(0);
			}
			return 0;
		} catch (e) {
			if (e instanceof c) return this.can_thread_spawn && this.thread_spawner.done_notify(e.code), e.code;
			throw e;
		}
	}
	start_only(e) {
		this.inst = e, e.exports._start();
	}
	initialize_only(e) {
		this.inst = e;
	}
	async async_start_on_thread() {
		if (!this.can_thread_spawn || !this.thread_spawner) throw Error("thread_spawn is not supported");
		if (await this.wait_worker_background_worker(), this.inst) throw Error("what happened?");
		let e = this.thread_spawner.get_share_memory();
		for (let t in e) new Uint8Array(e[t].buffer).fill(0);
		let t = this.thread_spawner.async_wait_done_or_error();
		return await this.thread_spawner.async_start_on_thread(this.args, this.env, this.fd_map), await t;
	}
	block_start_on_thread() {
		if (!this.can_thread_spawn || !this.thread_spawner) throw Error("thread_spawn is not supported");
		if (console.log("block_start_on_thread"), this.check_worker_background_worker(), console.log("block_start_on_thread"), this.inst) throw Error("what happened?");
		let e = this.thread_spawner.get_share_memory();
		for (let t in e) new Uint8Array(e[t].buffer).fill(0);
		console.log("block_start_on_thread: start"), this.thread_spawner.block_start_on_thread(this.args, this.env, this.fd_map), console.log("block_start_on_thread: wait");
		let t = this.thread_spawner.block_wait_done_or_error();
		return console.log("block_start_on_thread: done"), t;
	}
	wasi_thread_start(e, t, n) {
		this.inst = e, e.exports.wasi_thread_start(t, n);
	}
	initialize(e) {
		this.inst = e, e.exports._initialize && e.exports._initialize();
	}
	mapping_fds(e, t) {
		this.fd_map = [
			void 0,
			void 0,
			void 0
		];
		for (let n = 0; n < e.length; n++) {
			let r = e[n], i = t ? t[n] : r.default_fds, a = r.get_stdin(), o = r.get_stdout(), s = r.get_stderr();
			a !== void 0 && this.fd_map[0] === void 0 && i.includes(a) && (this.fd_map[0] = [a, n]), o !== void 0 && this.fd_map[1] === void 0 && i.includes(o) && (this.fd_map[1] = [o, n]), s !== void 0 && this.fd_map[2] === void 0 && i.includes(s) && (this.fd_map[2] = [s, n]);
			for (let e of i) e === a || e === o || e === s || this.map_new_fd(e, n);
			r.set_park_fds_map(i);
		}
		if (this.fd_map[0] === void 0) throw Error("stdin is not found");
		if (this.fd_map[1] === void 0) throw Error("stdout is not found");
		if (this.fd_map[2] === void 0) throw Error("stderr is not found");
	}
	map_new_fd(e, t) {
		let n = -1;
		for (let e = 3; e < this.fd_map.length; e++) if (this.fd_map[e] === void 0) {
			n = e;
			break;
		}
		return n === -1 && (n = this.fd_map.push(void 0) - 1), this.fd_map[n] = [e, t], n;
	}
	map_new_fd_and_notify(e, t) {
		let n = this.map_new_fd(e, t);
		return this.wasi_farm_refs[t].set_park_fds_map([e]), n;
	}
	check_fds() {
		let e = [];
		for (let t = 0; t < this.id_in_wasi_farm_ref.length; t++) {
			let n = this.id_in_wasi_farm_ref[t], r = this.wasi_farm_refs[t].get(n);
			if (r) for (let n of r) e.push([n, t]);
		}
		if (e.length > 0) for (let t = 0; t < this.fd_map.length; t++) {
			let n = this.fd_map[t];
			if (!n) continue;
			let [r, i] = n;
			for (let [n, a] of e) if (r === n && i === a) {
				this.fd_map[t] = void 0;
				break;
			}
		}
	}
	get_share_memory() {
		if (!this.thread_spawner) throw Error("thread_spawner is not defined");
		return this.thread_spawner.get_share_memory();
	}
	create_destroyer() {
		if (!this.thread_spawner) throw Error("You should enable thread_spawn to use create_destroyer");
		return this.thread_spawner.create_destroyer(this.animal_id);
	}
	init_destroyer(e) {
		if (!this.thread_spawner || this.animal_id === void 0) throw Error("thread spawner is not available");
		return this.thread_spawner.is_managed_worker_context() ? Ce.init_bound(e, this.animal_id) : Ce.init_self(e);
	}
	async_destroy() {
		return this.destroy_promise ??= (async () => {
			let e = this.thread_spawner;
			try {
				if (e !== void 0) {
					let t = e.is_managed_worker_context() ? this.animal_id : void 0;
					await e.async_destroy(t);
				}
			} finally {
				this.inst = void 0, this.wasi_farm_refs = [], this.id_in_wasi_farm_ref = [], this.fd_map = [], this.thread_spawner = void 0;
			}
		})();
	}
	destroy() {
		let e = this.thread_spawner;
		if (e !== void 0) {
			let t = e.is_managed_worker_context() ? this.animal_id : void 0;
			e.destroy(t);
		}
		this.inst = void 0, this.wasi_farm_refs = [], this.id_in_wasi_farm_ref = [], this.fd_map = [];
	}
	destroy_park(e) {
		if (e < 0 || e >= this.wasi_farm_refs.length) throw Error(`wasi_farm_refs index ${e} is out of bounds.`);
		let t = this.wasi_farm_refs[e];
		typeof t.destroy_park == "function" && t.destroy_park();
	}
	destroy_park_all() {
		for (let e = 0; e < this.wasi_farm_refs.length; e++) this.destroy_park(e);
	}
	destroy_with_park() {
		this.destroy_park_all(), this.destroy();
	}
	call_unknown_fn(e, t) {
		if (e < 0 || e >= this.wasi_farm_refs.length) throw Error(`wasi_farm_refs index ${e} is out of bounds.`);
		return this.wasi_farm_refs[e].call_unknown_fn(t);
	}
	kill_animal(e) {
		this.thread_spawner?.kill_animal(e);
	}
	constructor(n, r, o, s = {}, l, u, d) {
		let f;
		f = Array.isArray(n) ? n : [n];
		try {
			new SharedArrayBuffer(4), this.can_array_buffer = !0;
		} catch {
			this.can_array_buffer = !1;
		}
		this.id_in_wasi_farm_ref = [], this.wasi_farm_refs = [];
		for (let e = 0; e < f.length; e++) {
			if (this.can_array_buffer) this.wasi_farm_refs.push(zt.init_self(f[e]));
			else throw Error("Non SharedArrayBuffer is not supported yet");
			this.id_in_wasi_farm_ref.push(this.wasi_farm_refs[e].set_id());
		}
		if (s.can_thread_spawn) {
			if (this.can_thread_spawn = s.can_thread_spawn, u) {
				if (!(u instanceof Vt)) throw Error("thread_spawner is not ThreadSpawner");
				this.thread_spawner = u;
			} else {
				if (s.thread_spawn_worker_url === void 0) throw Error("thread_spawn_worker_url is not defined");
				if (s.thread_spawn_wasm === void 0) throw Error("thread_spawn_wasm is not defined");
				this.thread_spawner = new Vt(s.thread_spawn_worker_url, f, s.share_memory, void 0, void 0, s.thread_spawn_wasm, s.worker_background_worker_url);
			}
			if (this.thread_spawner.is_managed_worker_context()) {
				if (d === void 0) throw Error("assigned animal ID is not defined");
				this.animal_id = d;
			} else this.animal_id = this.thread_spawner.generate_animal_id();
		}
		this.mapping_fds(this.wasi_farm_refs, l), s.hand_override_fd_map && (this.fd_map = s.hand_override_fd_map), this.args = r, this.env = o;
		let p = this;
		this.wasiImport = {
			args_sizes_get(e, t) {
				p.check_fds();
				let n = new DataView(p.inst.exports.memory.buffer);
				n.setUint32(e, p.args.length, !0);
				let r = 0;
				for (let e of p.args) r += e.length + 1;
				return n.setUint32(t, r, !0), 0;
			},
			args_get(e, t) {
				p.check_fds();
				let n = new DataView(p.inst.exports.memory.buffer), r = new Uint8Array(p.inst.exports.memory.buffer);
				for (let i = 0; i < p.args.length; i++) {
					n.setUint32(e, t, !0), e += 4;
					let a = new TextEncoder().encode(p.args[i]);
					r.set(a, t), n.setUint8(t + a.length, 0), t += a.length + 1;
				}
				return 0;
			},
			environ_sizes_get(e, t) {
				p.check_fds();
				let n = new DataView(p.inst.exports.memory.buffer);
				n.setUint32(e, p.env.length, !0);
				let r = 0;
				for (let e of p.env) r += e.length + 1;
				return n.setUint32(t, r, !0), 0;
			},
			environ_get(e, t) {
				p.check_fds();
				let n = new DataView(p.inst.exports.memory.buffer), r = new Uint8Array(p.inst.exports.memory.buffer);
				for (let i = 0; i < p.env.length; i++) {
					n.setUint32(e, t, !0), e += 4;
					let a = new TextEncoder().encode(p.env[i]);
					r.set(a, t), n.setUint8(t + a.length, 0), t += a.length + 1;
				}
				return 0;
			},
			clock_res_get(e, t) {
				p.check_fds();
				let n;
				switch (e) {
					case 1:
						n = 5000n;
						break;
					case 0:
						n = 1000000n;
						break;
					default: return 52;
				}
				return new DataView(p.inst.exports.memory.buffer).setBigUint64(t, n, !0), 0;
			},
			clock_time_get(e, t, n) {
				p.check_fds();
				let r = new DataView(p.inst.exports.memory.buffer);
				if (e === 0) r.setBigUint64(n, BigInt(Date.now()) * 1000000n, !0);
				else if (e === 1) {
					let e;
					try {
						e = BigInt(Math.round(performance.now() * 1e6));
					} catch {
						e = 0n;
					}
					r.setBigUint64(n, e, !0);
				} else r.setBigUint64(n, 0n, !0);
				return 0;
			},
			fd_advise(e, t, n, r) {
				p.check_fds();
				let [i, a] = p.get_fd_and_wasi_ref(e);
				return i === void 0 || a === void 0 ? 8 : a.fd_advise(i);
			},
			fd_allocate(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				return r === void 0 || i === void 0 ? 8 : i.fd_allocate(r, t, n);
			},
			fd_close(e) {
				p.check_fds();
				let [t, n] = p.get_fd_and_wasi_ref(e);
				if (t === void 0 || n === void 0) return 8;
				let r = n.fd_close(t);
				return p.check_fds(), r;
			},
			fd_datasync(e) {
				p.check_fds();
				let [t, n] = p.get_fd_and_wasi_ref(e);
				return t === void 0 || n === void 0 ? 8 : n.fd_datasync(t);
			},
			fd_fdstat_get(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				if (n === void 0 || r === void 0) return 8;
				let [i, a] = r.fd_fdstat_get(n);
				return i && i.write_bytes(new DataView(p.inst.exports.memory.buffer), t), a;
			},
			fd_fdstat_set_flags(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				return n === void 0 || r === void 0 ? 8 : r.fd_fdstat_set_flags(n, t);
			},
			fd_fdstat_set_rights(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				return r === void 0 || i === void 0 ? 8 : i.fd_fdstat_set_rights(r, t, n);
			},
			fd_filestat_get(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				if (n === void 0 || r === void 0) return 8;
				let [i, a] = r.fd_filestat_get(n);
				return i && i.write_bytes(new DataView(p.inst.exports.memory.buffer), t), a;
			},
			fd_filestat_set_size(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				return n === void 0 || r === void 0 ? 8 : r.fd_filestat_set_size(n, t);
			},
			fd_filestat_set_times(e, t, n, r) {
				p.check_fds();
				let [i, a] = p.get_fd_and_wasi_ref(e);
				return i === void 0 || a === void 0 ? 8 : a.fd_filestat_set_times(i, t, n, r);
			},
			fd_pread(t, n, r, i, a) {
				p.check_fds();
				let [o, s] = p.get_fd_and_wasi_ref(t);
				if (o === void 0 || s === void 0) return 8;
				let c = new DataView(p.inst.exports.memory.buffer), l = new Uint8Array(p.inst.exports.memory.buffer), u = new Uint32Array(c.buffer, n, r * 2), [d, f] = s.fd_pread(o, u, i);
				if (d) {
					let t = e.read_bytes_array(c, n, r), [i, o] = d;
					c.setUint32(a, i, !0);
					let s = 0;
					for (let e of t) {
						if (s + e.buf_len >= o.length) {
							l.set(o, e.buf);
							break;
						}
						l.set(o.slice(s, s + e.buf_len), e.buf), s += e.buf_len;
					}
				}
				return f;
			},
			fd_prestat_get(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				if (n === void 0 || r === void 0) return 8;
				let [i, a] = r.fd_prestat_get(n);
				if (i) {
					let [e, n] = i, r = new DataView(p.inst.exports.memory.buffer);
					r.setUint32(t, e, !0), r.setUint32(t + 4, n, !0);
				}
				return a;
			},
			fd_prestat_dir_name(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				if (r === void 0 || i === void 0) return [void 0, 8];
				let [a, o] = i.fd_prestat_dir_name(r, n);
				return a && new Uint8Array(p.inst.exports.memory.buffer).set(a, t), o;
			},
			fd_pwrite(e, n, r, i, a) {
				p.check_fds();
				let [o, s] = p.get_fd_and_wasi_ref(e);
				if (o === void 0 || s === void 0) return 8;
				let c = new DataView(p.inst.exports.memory.buffer), l = new Uint8Array(p.inst.exports.memory.buffer), u = t.read_bytes_array(c, n, r), d = new Uint8Array(u.reduce((e, t) => e + t.buf_len, 0)), f = 0;
				for (let e of u) d.set(l.slice(e.buf, e.buf + e.buf_len), f), f += e.buf_len;
				let [m, h] = s.fd_pwrite(o, d, i);
				return m && c.setUint32(a, m, !0), h;
			},
			fd_read(t, n, r, i) {
				p.check_fds();
				let [a, o] = p.get_fd_and_wasi_ref(t);
				if (a === void 0 || o === void 0) return 8;
				let s = new DataView(p.inst.exports.memory.buffer), c = new Uint8Array(p.inst.exports.memory.buffer), l = new Uint32Array(s.buffer, n, r * 2), [u, d] = o.fd_read(a, l);
				if (u) {
					let t = e.read_bytes_array(s, n, r), [a, o] = u;
					s.setUint32(i, a, !0);
					let l = 0;
					for (let e of t) {
						if (l + e.buf_len >= o.length) {
							c.set(o, e.buf);
							break;
						}
						c.set(o.slice(l, l + e.buf_len), e.buf), l += e.buf_len;
					}
				}
				return d;
			},
			fd_readdir(e, t, n, r, i) {
				p.check_fds();
				let [a, o] = p.get_fd_and_wasi_ref(e);
				if (a === void 0 || o === void 0) return [void 0, 8];
				let s = new DataView(p.inst.exports.memory.buffer), c = new Uint8Array(p.inst.exports.memory.buffer), [l, u] = o.fd_readdir(a, n, r);
				if (l) {
					let [e, n] = l;
					s.setUint32(i, n, !0), c.set(e, t);
				}
				return u;
			},
			fd_renumber(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(t);
				if (n !== void 0 && r !== void 0) {
					let e = r.fd_close(n);
					if (p.check_fds(), e !== 0) return e;
				}
				if (p.fd_map[t]) throw Error("fd is already mapped");
				return p.fd_map[t] = p.fd_map[e], p.fd_map[e] = void 0, 0;
			},
			fd_seek(e, t, n, r) {
				p.check_fds();
				let [i, a] = p.get_fd_and_wasi_ref(e);
				if (i === void 0 || a === void 0) return [void 0, 8];
				let [o, s] = a.fd_seek(i, t, n);
				return o && new DataView(p.inst.exports.memory.buffer).setBigUint64(r, o, !0), s;
			},
			fd_sync(e) {
				p.check_fds();
				let [t, n] = p.get_fd_and_wasi_ref(e);
				return t === void 0 || n === void 0 ? 8 : n.fd_sync(t);
			},
			fd_tell(e, t) {
				p.check_fds();
				let [n, r] = p.get_fd_and_wasi_ref(e);
				if (n === void 0 || r === void 0) return [void 0, 8];
				let [i, a] = r.fd_tell(n);
				return i && new DataView(p.inst.exports.memory.buffer).setBigUint64(t, i, !0), a;
			},
			fd_write(e, n, r, i) {
				p.check_fds();
				let [a, o] = p.get_fd_and_wasi_ref(e);
				if (a === void 0 || o === void 0) return 8;
				let s = new DataView(p.inst.exports.memory.buffer), c = new Uint8Array(p.inst.exports.memory.buffer), l = t.read_bytes_array(s, n, r), u = new Uint8Array(l.reduce((e, t) => e + t.buf_len, 0)), d = 0;
				for (let e of l) u.set(c.slice(e.buf, e.buf + e.buf_len), d), d += e.buf_len;
				let [f, m] = o.fd_write(a, u);
				return f && s.setUint32(i, f, !0), m;
			},
			path_create_directory(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				if (r === void 0 || i === void 0) return 8;
				let a = new Uint8Array(p.inst.exports.memory.buffer).slice(t, t + n);
				return i.path_create_directory(r, a);
			},
			path_filestat_get(e, t, n, r, i) {
				p.check_fds();
				let [a, o] = p.get_fd_and_wasi_ref(e);
				if (a === void 0 || o === void 0) return [void 0, 8];
				let s = new DataView(p.inst.exports.memory.buffer), c = new Uint8Array(p.inst.exports.memory.buffer).slice(n, n + r), [l, u] = o.path_filestat_get(a, t, c);
				return l && l.write_bytes(s, i), u;
			},
			path_filestat_set_times(e, t, n, r, i, a, o) {
				p.check_fds();
				let [s, c] = p.get_fd_and_wasi_ref(e);
				if (s === void 0 || c === void 0) return [void 0, 8];
				let l = new Uint8Array(p.inst.exports.memory.buffer).slice(n, n + r);
				return c.path_filestat_set_times(s, t, l, i, a, o);
			},
			path_link(e, t, n, r, i, a, o) {
				p.check_fds();
				let [s, c] = p.get_fd_and_wasi_ref(e), [l, u] = p.get_fd_and_wasi_ref(i);
				if (s === void 0 || c === void 0 || l === void 0 || u === void 0 || c !== u) return 8;
				let d = new Uint8Array(p.inst.exports.memory.buffer), f = d.slice(n, n + r), m = d.slice(a, a + o);
				return c.path_link(s, t, f, l, m);
			},
			path_open(e, t, n, r, i, a, o, s, c) {
				p.check_fds();
				let [l, u] = p.get_fd_and_wasi_ref_n(e);
				if (l === void 0 || u === void 0) return 8;
				let d = p.wasi_farm_refs[u], f = new Uint8Array(p.inst.exports.memory.buffer).slice(n, n + r), [m, h] = d.path_open(l, t, f, i, a, o, s);
				if (m) {
					if (p.fd_map.includes([m, u])) throw Error("opened_fd already exists");
					let e = p.map_new_fd_and_notify(m, u);
					new DataView(p.inst.exports.memory.buffer).setUint32(c, e, !0);
				}
				return h;
			},
			path_readlink(e, t, n, r, i, a) {
				p.check_fds();
				let [o, s] = p.get_fd_and_wasi_ref(e);
				if (o === void 0 || s === void 0) return [void 0, 8];
				let c = new Uint8Array(p.inst.exports.memory.buffer), l = c.slice(t, t + n), [u, d] = s.path_readlink(o, l, i);
				return u && (new DataView(p.inst.exports.memory.buffer).setUint32(a, u.length, !0), c.set(u, r)), d;
			},
			path_remove_directory(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				if (r === void 0 || i === void 0) return 8;
				let a = new Uint8Array(p.inst.exports.memory.buffer).slice(t, t + n);
				return i.path_remove_directory(r, a);
			},
			path_rename(e, t, n, r, i, a) {
				if (e === r) return 0;
				p.check_fds();
				let [o, s] = p.get_fd_and_wasi_ref(e), [c, l] = p.get_fd_and_wasi_ref(r);
				if (o === void 0 || s === void 0 || c === void 0 || l === void 0 || s !== l) return 8;
				let u = new Uint8Array(p.inst.exports.memory.buffer), d = u.slice(t, t + n), f = u.slice(i, i + a);
				return s.path_rename(o, d, c, f);
			},
			path_symlink(e, t, n, r, i) {
				p.check_fds();
				let [a, o] = p.get_fd_and_wasi_ref(n);
				if (a === void 0 || o === void 0) return 8;
				let s = new Uint8Array(p.inst.exports.memory.buffer), c = s.slice(e, e + t), l = s.slice(r, r + i);
				return o.path_symlink(c, a, l);
			},
			path_unlink_file(e, t, n) {
				p.check_fds();
				let [r, i] = p.get_fd_and_wasi_ref(e);
				if (r === void 0 || i === void 0) return 8;
				let a = new Uint8Array(p.inst.exports.memory.buffer).slice(t, t + n);
				return i.path_unlink_file(r, a);
			},
			poll_oneoff(e, t, n, r) {
				if (n === 0) return 28;
				if (n > 1) return console.error("poll_oneoff: only a single subscription is supported"), 58;
				let o = new DataView(p.inst.exports.memory.buffer), s = i.read_bytes(o, e), c = s.eventtype, l = s.clockid, u = s.timeout;
				if (c !== 0) return console.error("poll_oneoff: only clock subscriptions are supported"), 58;
				let d;
				if (l === 1) d = () => BigInt(Math.round(performance.now() * 1e6));
				else if (l === 0) d = () => BigInt(Date.now()) * 1000000n;
				else return 28;
				let f = o.getBigUint64(e + 32, !0), m = (o.getUint16(e + 40, !0) & 1 ? u : d() + u) - f - d();
				if (m > 0n) {
					let e = Number(m / 1000000n);
					e > 0 && Atomics.wait(p.sleepBuffer, 0, 0, e);
				}
				return new a(s.userdata, 0, c).write_bytes(o, t), o.setUint32(r, 1, !0), 0;
			},
			proc_exit(e) {
				throw p.check_fds(), new c(e);
			},
			proc_raise(e) {
				throw p.check_fds(), `raised signal ${e}`;
			},
			sched_yield() {
				p.check_fds();
			},
			random_get(e, t) {
				p.check_fds();
				let n = new Uint8Array(p.inst.exports.memory.buffer).subarray(e, e + t);
				if ("crypto" in globalThis && !(p.inst.exports.memory.buffer instanceof SharedArrayBuffer)) for (let e = 0; e < t; e += 65536) crypto.getRandomValues(n.subarray(e, e + 65536));
				else for (let e = 0; e < t; e++) n[e] = Math.random() * 256 | 0;
			},
			sock_recv(e, t, n) {
				throw p.check_fds(), "sockets not supported";
			},
			sock_send(e, t, n) {
				throw p.check_fds(), "sockets not supported";
			},
			sock_shutdown(e, t) {
				throw p.check_fds(), "sockets not supported";
			},
			sock_accept(e, t) {
				throw p.check_fds(), "sockets not supported";
			}
		}, this.wasiThreadImport = { "thread-spawn": (e) => {
			if (p.check_fds(), !p.can_thread_spawn || !p.thread_spawner) throw Error("thread_spawn is not allowed");
			return p.thread_spawner.thread_spawn(e, p.args, p.env, p.fd_map);
		} };
	}
}, Kt = class {
	fds;
	park;
	can_array_buffer;
	constructor(e, t, n, r = [], i = {}) {
		let a = [], o, s, c;
		e && (a.push(e), o = a.length - 1), t && (a.push(t), s = a.length - 1), n && (a.push(n), c = a.length - 1), a.push(...r);
		let l = [];
		for (let e = 0; e < a.length; e++) l.push(e);
		this.fds = a;
		try {
			new SharedArrayBuffer(4), this.can_array_buffer = !0;
		} catch (e) {
			this.can_array_buffer = !1, console.warn("SharedArrayBuffer is not supported:", e), globalThis.crossOriginIsolated || console.warn("SharedArrayBuffer is not supported because crossOriginIsolated is not enabled.");
		}
		if (this.can_array_buffer) this.park = new It(this.fds_ref(), o, s, c, l, i?.allocator_size, i?.max_fds_limit, i?.unknown_fn, i?.max_base_calls_limit, i?.base_call_allocator_size);
		else throw Error("Non SharedArrayBuffer is not supported yet");
		this.park.listen();
	}
	fds_ref() {
		return new Proxy([], {
			get: (e, t) => t === "push" ? (e) => this.fds.push(e) : this.fds[t],
			set: (e, t, n) => (this.fds[t] = n, !0)
		});
	}
	get_ref() {
		if (this.park === null) throw Error("WASIFarm is already destroyed");
		return this.park.get_ref();
	}
	destroy() {
		this.park?.destroy(), this.park = null;
	}
};
//#endregion
//#region src/shared_array_buffer/worker_background/worker_background_worker_minify.js
function qt() {
	let e = class e {
		share_arrays_memory;
		constructor(e = new SharedArrayBuffer(10485760), t = !0) {
			if (this.share_arrays_memory = e, t) {
				let e = new Int32Array(this.share_arrays_memory);
				Atomics.store(e, 0, 0), Atomics.store(e, 1, 0), Atomics.store(e, 2, 12);
			}
		}
		static init_self(t) {
			return new e(t.share_arrays_memory, !1);
		}
		async async_write(e, t, n) {
			let r = new Int32Array(this.share_arrays_memory);
			for (;;) {
				let { value: i } = Atomics.waitAsync(r, 0, 1);
				if ((i instanceof Promise ? await i : i) === "timed-out") throw Error("timed-out lock");
				if (Atomics.compareExchange(r, 0, 0, 1) === 0) try {
					return this.write_inner(e, t, n);
				} finally {
					Atomics.store(r, 0, 0), Atomics.notify(r, 0, 1);
				}
			}
		}
		block_write(e, t, n) {
			for (;;) {
				let r = new Int32Array(this.share_arrays_memory);
				if (Atomics.wait(r, 0, 1) === "timed-out") throw Error("timed-out lock");
				if (Atomics.compareExchange(r, 0, 0, 1) === 0) try {
					return this.write_inner(e, t, n);
				} finally {
					Atomics.store(r, 0, 0), Atomics.notify(r, 0, 1);
				}
			}
		}
		write_inner(e, t, n) {
			let r, i, a = new Int32Array(this.share_arrays_memory), o = new Uint8Array(this.share_arrays_memory);
			r = Atomics.add(a, 1, 1) === 0 ? Atomics.store(a, 2, 12) : Atomics.load(a, 2);
			let s = this.share_arrays_memory.byteLength, c = e.byteLength, l = r + c;
			if (s < l) throw Atomics.sub(a, 1, 1), Error("size is bigger than memory. \nTODO! fix memory limit. support big size another way.");
			if (e instanceof Uint8Array) i = e;
			else if (e instanceof Uint32Array) {
				let t = new ArrayBuffer(e.byteLength);
				new Uint32Array(t).set(e), i = new Uint8Array(t);
			}
			o.set(new Uint8Array(i), r), Atomics.store(a, 2, l);
			let u = new Int32Array(t);
			return Atomics.store(u, n, r), Atomics.store(u, n + 1, c), [r, c];
		}
		free(e, t) {
			Atomics.sub(new Int32Array(this.share_arrays_memory), 1, 1);
		}
		get_memory(e, t) {
			let n = new ArrayBuffer(t);
			return new Uint8Array(n).set(new Uint8Array(this.share_arrays_memory).slice(e, e + t)), n;
		}
		take_memory(e, t) {
			if (!Number.isInteger(e) || !Number.isInteger(t) || e < 12 || t < 0 || e > this.share_arrays_memory.byteLength - t) throw RangeError("allocation is outside allocator data memory");
			try {
				return this.get_memory(e, t);
			} finally {
				this.free(e, t);
			}
		}
		use_defined_memory(e, t, n) {
			new Uint8Array(this.share_arrays_memory).set(new Uint8Array(n).slice(0, t), e);
		}
		get_object() {
			return { share_arrays_memory: this.share_arrays_memory };
		}
	}, t = (e) => ({
		message: e.message,
		name: e.name,
		stack: e.stack,
		cause: e.cause
	});
	var n = function(e) {
		return e[e.Running = 0] = "Running", e[e.Destroying = 1] = "Destroying", e[e.Destroyed = 2] = "Destroyed", e[e.Failed = 3] = "Failed", e;
	}({}), r = function(e) {
		return e[e.None = 0] = "None", e[e.RequesterDrained = 1] = "RequesterDrained", e[e.Closing = 2] = "Closing", e;
	}({}), i = function(e) {
		return e[e.None = 0] = "None", e[e.CoordinatorBootstrap = 1] = "CoordinatorBootstrap", e[e.CoordinatorRuntime = 2] = "CoordinatorRuntime", e[e.WorkerBootstrap = 3] = "WorkerBootstrap", e[e.Protocol = 4] = "Protocol", e;
	}({});
	let a = class extends Error {
		code;
		constructor(e) {
			super("worker destroy failed: " + i[e]), this.code = e, this.name = "WorkerDestroyError";
		}
	};
	function o(e) {
		if (e === void 0) return 0;
		if (!Number.isInteger(e) || e < 0 || e > 1073741822) throw RangeError("animal_id must be in 0..1073741822");
		return e + 1;
	}
	function s(e, t) {
		return o(t) << 2 | e;
	}
	function c(e) {
		return 3 & Atomics.load(e, 0);
	}
	function l(e) {
		let t = Atomics.load(e, 0) >>> 2;
		return t === 0 ? void 0 : t - 1;
	}
	function u(e, t) {
		let n = s(1, t), r = Atomics.compareExchange(e, 0, 0, n) === 0;
		return r && d(e), r;
	}
	function d(e) {
		Atomics.add(e, 3, 1), Atomics.notify(e, 3);
	}
	function f(e, t) {
		for (;;) {
			let n = Atomics.load(e, 0), r = 3 & n;
			if (r === 2 || r === 3) return;
			if (r !== 1) throw new a(4);
			let i = -4 & n | t;
			if (Atomics.compareExchange(e, 0, n, i) === n) return void d(e);
		}
	}
	function p(e) {
		f(e, 2);
	}
	function m(e, t) {
		let n = c(e);
		if (n !== 2 && n !== 3) {
			if (n === 0) throw new a(4);
			Atomics.compareExchange(e, 2, 0, t), f(e, 3);
		}
	}
	function h(e) {
		Atomics.store(e, 1, 2), d(e);
	}
	var g = function(e) {
		return e[e.Pending = 0] = "Pending", e[e.Completing = 1] = "Completing", e[e.Ready = 2] = "Ready", e[e.Failed = 3] = "Failed", e[e.Cancelled = 4] = "Cancelled", e;
	}({}), _ = function(e) {
		return e[e.None = 0] = "None", e[e.Destroyed = 1] = "Destroyed", e[e.ScriptLoad = 2] = "ScriptLoad", e[e.AnimalConstruction = 3] = "AnimalConstruction", e[e.WasmInstantiation = 4] = "WasmInstantiation", e[e.Protocol = 5] = "Protocol", e;
	}({}), ee = function(e) {
		return e[e.Waiting = 0] = "Waiting", e[e.Error = 1] = "Error", e[e.Exit = 2] = "Exit", e[e.Done = 3] = "Done", e[e.Cancelled = 4] = "Cancelled", e[e.Completing = 5] = "Completing", e[e.ErrorConsumed = 6] = "ErrorConsumed", e;
	}({});
	function v(e, t, n) {
		if (!(e.buffer instanceof SharedArrayBuffer)) throw TypeError(`${n} must use SharedArrayBuffer`);
		if (e.byteLength !== t) throw RangeError(`${n} must be exactly ${t} bytes`);
	}
	function te(e) {
		return e === 2 || e === 3 || e === 4;
	}
	function y(e, t, n) {
		if (!Number.isInteger(t) || t < 12) throw RangeError("worker request pointer must be in allocator data memory");
		if (!Number.isInteger(n) || n !== 12) throw RangeError("worker request length must be exactly 12");
		if (t % Int32Array.BYTES_PER_ELEMENT != 0) throw RangeError("worker request pointer must be four-byte aligned");
		if (t > e.byteLength - n) throw RangeError("worker request is outside shared allocator memory");
		return new Int32Array(e, t, 3);
	}
	function ne(e) {
		return v(e, 12, "runtime completion view"), Atomics.compareExchange(e, 0, 0, 5) === 0;
	}
	function b(e, t, n) {
		if (v(e, 12, "runtime completion view"), v(n, 16, "destroy status view"), t !== 1 && t !== 2 && t !== 3 && t !== 4) throw RangeError("runtime completion state must be terminal");
		if (Atomics.compareExchange(e, 0, 5, t) !== 5) throw Error("runtime completion was not claimed");
		Atomics.notify(e, 0), d(n);
	}
	function x(e, t, n, r, i) {
		if (v(e, 12, "worker request view"), v(i, 16, "destroy status view"), !te(t)) throw RangeError("worker request completion state must be terminal");
		return Atomics.compareExchange(e, 0, 0, 1) === 0 && (Atomics.store(e, 1, n), Atomics.store(e, 2, r), Atomics.store(e, 0, t), Atomics.notify(e, 0), d(i), !0);
	}
	var S = function(e) {
		return e[e.Published = 0] = "Published", e[e.Idle = 1] = "Idle", e[e.Preparing = 2] = "Preparing", e[e.Claimed = 3] = "Claimed", e;
	}({}), C = function(e) {
		return e[e.Free = 0] = "Free", e[e.Caller = 1] = "Caller", e[e.Reserved = 2] = "Reserved", e[e.CallerReserved = 3] = "CallerReserved", e[e.Coordinator = 4] = "Coordinator", e;
	}({});
	function re(e) {
		for (;;) {
			let t = Atomics.load(e, 0);
			if (t !== 0 && t !== 1) return;
			let n = t === 0 ? 2 : 3;
			if (Atomics.compareExchange(e, 0, t, n) === t) {
				w(e), Atomics.notify(e, 0);
				return;
			}
		}
	}
	function ie(e) {
		Atomics.store(e, 0, 0), w(e), Atomics.notify(e, 0);
	}
	function w(e) {
		Atomics.add(e, 6, 1), Atomics.notify(e, 6);
	}
	function ae(e) {
		return e instanceof Error ? e : Error(e + "");
	}
	let oe = class a {
		override_object;
		allocator;
		lock;
		signature_input;
		destroy_status;
		workers = [void 0];
		listen_holder;
		start_worker;
		start_worker_requested = !1;
		animal_workers = /* @__PURE__ */ new Map();
		pending_animal_workers = /* @__PURE__ */ new Map();
		worker_animals = /* @__PURE__ */ new Map();
		next_animal_id = 0;
		free_animal_ids = [];
		terminated_records = /* @__PURE__ */ new WeakSet();
		pending_retirements = /* @__PURE__ */ new Set();
		stopping_workers = !1;
		teardown_promise;
		teardown_failure;
		teardown_requester;
		schedule_timeout = setTimeout;
		cancel_timeout = clearTimeout;
		constructor(t, n, r, i, a) {
			this.override_object = t, this.destroy_status = n, this.lock = r ?? new SharedArrayBuffer(28);
			let o = new Int32Array(this.lock);
			Atomics.load(o, 1) === 0 && Atomics.load(o, 2) === 0 && (Atomics.store(o, 1, S.Idle), w(o)), this.allocator = i ?? new e(new SharedArrayBuffer(10240)), this.signature_input = a ?? new SharedArrayBuffer(32), this.listen_holder = this.listen();
		}
		static init_self(t, n) {
			return new a(t, n.destroy_status, n.lock, e.init_self(n.allocator), n.signature_input);
		}
		assign_worker_id() {
			for (let e = 1; e < this.workers.length; e++) if (this.workers[e] === void 0) return e;
			return this.workers.push(void 0), this.workers.length - 1;
		}
		allocate_animal_id() {
			let e = this.free_animal_ids.pop();
			if (e !== void 0) return e;
			if (this.next_animal_id > 1073741822) throw RangeError("no Animal IDs are available");
			return this.next_animal_id++;
		}
		release_animal_id(e) {
			this.free_animal_ids.push(e);
		}
		ref() {
			return {
				allocator: this.allocator.get_object(),
				lock: this.lock,
				signature_input: this.signature_input,
				destroy_status: this.destroy_status
			};
		}
		terminate_worker(e) {
			if (this.terminated_records.has(e)) return;
			let t = e.worker;
			t !== void 0 && (this.terminated_records.add(e), this.detach_handlers(e), t.terminate());
		}
		retire_record(e) {
			this.terminated_records.has(e) || (this.pending_retirements.add(e), re(new Int32Array(this.lock)));
		}
		drain_retirements() {
			for (let e of this.pending_retirements) this.retire_record_inner(e);
			this.pending_retirements.clear(), this.stopping_workers = !1;
		}
		retire_record_inner(e, t = !0) {
			if (e.retired) return !1;
			e.retired = !0;
			let n = !1;
			return e.worker_id > 0 && this.workers[e.worker_id] === e && (this.workers[e.worker_id] = void 0, n = !0), e.worker_id === 0 && this.start_worker === e && (this.start_worker = void 0, n = !0), this.pending_animal_workers.get(e.animal_id) === e && (this.pending_animal_workers.delete(e.animal_id), n = !0), this.animal_workers.get(e.animal_id) === e && (this.animal_workers.delete(e.animal_id), n = !0), n && this.worker_animals.get(e.worker_id) === e.animal_id && this.worker_animals.delete(e.worker_id), !n || this.pending_animal_workers.has(e.animal_id) || this.animal_workers.has(e.animal_id) || this.release_animal_id(e.animal_id), t && this.terminate_worker(e), n;
		}
		is_active_record(e) {
			return !e.retired && !this.pending_retirements.has(e) && (e.worker_id === 0 ? this.start_worker === e : this.workers[e.worker_id] === e);
		}
		mark_inactive_requester_closing(e) {
			return this.teardown_requester === e && (h(new Int32Array(this.destroy_status)), !0);
		}
		detach_handlers(e) {
			let t = e.worker;
			t !== void 0 && (t.onmessage = null, t.onerror = null, t.onmessageerror = null);
		}
		terminate_registered_workers() {
			this.stopping_workers = !0;
			let e = /* @__PURE__ */ new Set();
			for (let t of this.workers) t !== void 0 && e.add(t);
			for (let t of (this.start_worker !== void 0 && e.add(this.start_worker), this.pending_animal_workers.values())) e.add(t);
			for (let t of this.animal_workers.values()) e.add(t);
			let t = new Int32Array(this.destroy_status);
			for (let n of e) {
				let e = n.request_view;
				n.request_view = void 0, e !== void 0 && x(e, g.Cancelled, _.Destroyed, n.worker_id, t), this.retire_record(n);
			}
			re(new Int32Array(this.lock));
		}
		cancel_runtime() {
			let e = new Int32Array(this.lock, 12, 3);
			ne(e) && b(e, ee.Cancelled, new Int32Array(this.destroy_status));
		}
		teardown() {
			return this.teardown_promise ??= Promise.resolve().then(() => this.teardown_inner()), this.teardown_promise;
		}
		fail_runtime(e, t = i.CoordinatorRuntime) {
			this.teardown_failure ??= t, u(new Int32Array(this.destroy_status)), w(new Int32Array(this.lock));
		}
		record_teardown_error(e) {
			this.teardown_failure ??= i.CoordinatorRuntime, console.error(e);
		}
		async wait_for_requester_closing(e) {
			let t, n = (async () => {
				for (;;) {
					let t = Atomics.load(e, 1);
					if (t === r.Closing) return;
					let n = Atomics.load(e, 3), i = Atomics.load(e, 1);
					if (i === r.Closing) return;
					if (i !== t) continue;
					let { value: a } = Atomics.waitAsync(e, 3, n);
					if ((a instanceof Promise ? await a : a) === "timed-out") throw Error("atomic wait timed out");
				}
			})(), i = new Promise((e) => {
				t = this.schedule_timeout(e, 1e3);
			});
			await Promise.race([n, i]), t !== void 0 && this.cancel_timeout(t);
		}
		async teardown_inner() {
			let e = new Int32Array(this.lock), t = new Int32Array(this.destroy_status), a = l(t), o = a === void 0 ? void 0 : this.animal_workers.get(a) ?? this.pending_animal_workers.get(a), s = /* @__PURE__ */ new Set();
			for (let e of this.pending_retirements) s.add(e);
			for (let e of this.workers) e !== void 0 && s.add(e);
			for (let e of (this.start_worker !== void 0 && s.add(this.start_worker), this.pending_animal_workers.values())) s.add(e);
			for (let e of this.animal_workers.values()) s.add(e);
			for (let e of (this.teardown_requester = o, s)) {
				let n = e.request_view;
				if (e.request_view = void 0, n !== void 0) try {
					x(n, g.Cancelled, _.Destroyed, e.worker_id, t);
				} catch (e) {
					this.record_teardown_error(e);
				}
				try {
					this.retire_record_inner(e, e !== o);
				} catch (e) {
					this.record_teardown_error(e);
				}
			}
			this.workers = [void 0], this.start_worker = void 0, this.animal_workers.clear(), this.pending_animal_workers.clear(), this.worker_animals.clear(), this.pending_retirements.clear();
			try {
				this.cancel_runtime();
			} catch (e) {
				this.record_teardown_error(e);
			}
			if (ie(e), o !== void 0) {
				Atomics.store(t, 1, r.RequesterDrained), d(t);
				try {
					await this.wait_for_requester_closing(t);
				} catch (e) {
					this.record_teardown_error(e);
				}
				for (; await this.claim_command(e, !0);) try {
					this.cancel_claimed_command(new Int32Array(this.signature_input));
				} finally {
					this.acknowledge_command(e);
				}
				try {
					this.terminate_worker(o);
				} catch (e) {
					this.record_teardown_error(e);
				} finally {
					ie(e);
				}
			}
			this.teardown_requester = void 0;
			try {
				this.teardown_failure === void 0 ? p(t) : m(t, this.teardown_failure);
			} catch (e) {
				this.teardown_failure ??= i.CoordinatorRuntime;
				try {
					c(t) === n.Running && u(t), m(t, this.teardown_failure);
				} catch (t) {
					console.error(e, t);
				}
			}
			globalThis.close();
		}
		complete_request_ready(e, t) {
			if (!this.is_active_record(e)) return this.retire_record(e), !1;
			let r = e.request_view, i = new Int32Array(this.destroy_status), a = c(i) === n.Running && !this.stopping_workers, o = Number.isInteger(t) && t === e.animal_id, s = r !== void 0 && Atomics.load(r, 0) === g.Pending && this.pending_animal_workers.get(e.animal_id) === e;
			return o && s ? a ? (this.pending_animal_workers.delete(e.animal_id), this.animal_workers.set(e.animal_id, e), this.worker_animals.set(e.worker_id, e.animal_id), e.request_view = void 0, !!x(r, g.Ready, _.None, e.worker_id, i) || (this.retire_record(e), !1)) : (e.request_view = void 0, x(r, g.Cancelled, _.Destroyed, e.worker_id, i), this.retire_record(e), !1) : (r === void 0 ? this.retire_record(e) : this.complete_request_failure(e, _.Protocol), !1);
		}
		complete_request_failure(e, t) {
			if (!this.is_active_record(e)) return void this.retire_record(e);
			let n = e.request_view;
			e.request_view = void 0;
			try {
				n !== void 0 && x(n, g.Failed, t, e.worker_id, new Int32Array(this.destroy_status));
			} finally {
				this.retire_record(e);
			}
		}
		publish_runtime_exit(e) {
			let t = new Int32Array(this.lock, 12, 3);
			ne(t) && (Atomics.store(t, 1, e), b(t, ee.Exit, new Int32Array(this.destroy_status)));
		}
		publish_runtime_done() {
			let e = new Int32Array(this.lock, 12, 3);
			ne(e) && b(e, ee.Done, new Int32Array(this.destroy_status));
		}
		publish_runtime_error(e) {
			let n, r = new Int32Array(this.lock, 12, 3);
			try {
				let i = t(ae(e)), a = new TextEncoder().encode(JSON.stringify(i)), o = new Int32Array(this.allocator.share_arrays_memory);
				if (Atomics.compareExchange(o, 0, 0, 1) !== 0) throw Error("runtime error allocator is busy");
				try {
					n = this.allocator.write_inner(a, new SharedArrayBuffer(8), 0);
				} finally {
					Atomics.store(o, 0, 0), Atomics.notify(o, 0, 1);
				}
				if (!ne(r)) return void this.allocator.free(n[0], n[1]);
				Atomics.store(r, 1, n[0]), Atomics.store(r, 2, n[1]), b(r, ee.Error, new Int32Array(this.destroy_status));
			} catch (e) {
				n !== void 0 && this.allocator.free(n[0], n[1]), this.fail_runtime(e);
			}
		}
		take_allocation(e, t) {
			return this.allocator.take_memory(e, t);
		}
		read_command(e) {
			let t, n, r, i, a, o = Atomics.load(e, 6), s = Atomics.load(e, 7);
			try {
				t = y(this.allocator.share_arrays_memory, o, s);
			} catch (e) {
				n = e;
			}
			try {
				r = this.take_allocation(Atomics.load(e, 1), Atomics.load(e, 2));
			} catch (e) {
				a = e;
			}
			try {
				i = this.take_allocation(Atomics.load(e, 4), Atomics.load(e, 5));
			} catch (e) {
				a ??= e;
			}
			if (n !== void 0) throw n;
			if (a !== void 0) throw x(t, g.Failed, _.Protocol, 0, new Int32Array(this.destroy_status)), a;
			let c = new TextDecoder().decode(r);
			try {
				return {
					obj: JSON.parse(new TextDecoder().decode(i)),
					requestView: t,
					url: c
				};
			} catch (e) {
				throw x(t, g.Failed, _.Protocol, 0, new Int32Array(this.destroy_status)), e;
			}
		}
		cancel_claimed_command(e) {
			let t, n = Atomics.load(e, 0);
			if (n === 1 || n === 2) {
				try {
					t = y(this.allocator.share_arrays_memory, Atomics.load(e, 6), Atomics.load(e, 7));
				} catch (e) {
					this.teardown_failure ??= i.Protocol, console.error(e);
				}
				for (let [t, n] of [[1, 2], [4, 5]]) try {
					this.take_allocation(Atomics.load(e, t), Atomics.load(e, n));
				} catch (e) {
					this.teardown_failure ??= i.Protocol, console.error(e);
				}
				if (t !== void 0) try {
					x(t, g.Cancelled, _.Destroyed, 0, new Int32Array(this.destroy_status));
				} catch (e) {
					this.record_teardown_error(e);
				}
			}
		}
		acknowledge_command(e) {
			Atomics.store(e, 1, S.Idle), w(e), Atomics.store(e, 2, 0), Atomics.notify(e, 2, 1);
		}
		async claim_command(e, t = !1) {
			for (;;) {
				(t || this.pending_retirements.size > 0 || this.stopping_workers) && re(e);
				let n = Atomics.load(e, 6), r = Atomics.load(e, 1), i = Atomics.load(e, 0);
				if (r === S.Idle) {
					if (i === C.Coordinator) return !1;
					if (i === C.Reserved && Atomics.compareExchange(e, 0, C.Reserved, C.Coordinator) === C.Reserved) return w(e), !1;
					if (i === C.Free && !t) return !1;
				}
				if (r === S.Published) {
					if (Atomics.compareExchange(e, 1, S.Published, S.Claimed) === S.Published) return w(e), !0;
					continue;
				}
				if (r !== S.Idle && r !== S.Preparing && r !== S.Claimed) throw Error("unknown worker command state: " + r);
				if (Atomics.load(e, 1) !== r || Atomics.load(e, 0) !== i || Atomics.load(e, 6) !== n) continue;
				let { value: a } = Atomics.waitAsync(e, 6, n);
				if ((a instanceof Promise ? await a : a) === "timed-out") throw Error("timed-out");
			}
		}
		async finish_listen_teardown(e, t) {
			for (; await this.claim_command(e, !0);) try {
				this.cancel_claimed_command(t);
			} finally {
				this.acknowledge_command(e);
			}
			await this.teardown();
		}
		register_handlers(e, t) {
			let n = e.worker;
			n !== void 0 && (n.onmessage = (n) => {
				let i = n.data;
				if (!this.is_active_record(e)) {
					if (this.teardown_requester === e) {
						let t = typeof i == "object" && i ? i : void 0;
						t?.msg === "ready" && Number.isInteger(t.animal_id) && t.animal_id === e.animal_id && Atomics.load(new Int32Array(this.destroy_status), 1) === r.RequesterDrained || (t?.msg === "ready" || (t?.msg === "error" || t?.msg === "exit") && Number.isInteger(t.animal_id) && t.animal_id === e.animal_id) && this.mark_inactive_requester_closing(e);
						return;
					}
					this.retire_record(e);
					return;
				}
				if (typeof i != "object" || !i) {
					e.request_view !== void 0 && this.complete_request_failure(e, _.Protocol), this.fail_runtime(Error("invalid worker message"));
					return;
				}
				if ((i.msg === "ready" || i.msg === "done" || i.msg === "error" || i.msg === "exit") && (!Number.isInteger(i.animal_id) || i.animal_id !== e.animal_id)) return void (e.request_view === void 0 ? this.retire_record(e) : this.complete_request_failure(e, _.Protocol));
				if (i.msg === "ready") return void this.complete_request_ready(e, i.animal_id);
				if (i.msg === "done") {
					e.request_view === void 0 ? this.retire_record(e) : this.complete_request_failure(e, _.Protocol), t && (this.terminate_registered_workers(), this.publish_runtime_done());
					return;
				}
				if (i.msg === "error" || i.msg === "exit") {
					if (e.request_view !== void 0) {
						let t = i.msg === "error" && i.stage === "animal-construction" ? _.AnimalConstruction : i.msg === "error" && i.stage === "wasm-instantiation" ? _.WasmInstantiation : _.Protocol;
						this.complete_request_failure(e, t);
						return;
					}
					this.terminate_registered_workers(), i.msg === "error" ? this.publish_runtime_error(i.error ?? Error("worker error")) : this.publish_runtime_exit(i.code ?? 1);
					return;
				}
				e.request_view !== void 0 && this.complete_request_failure(e, _.Protocol), this.fail_runtime(Error("unknown worker message"));
			}, n.onerror = (t) => {
				if (t.preventDefault(), !this.is_active_record(e)) {
					if (this.mark_inactive_requester_closing(e)) return;
					this.retire_record(e);
					return;
				}
				e.request_view !== void 0 && this.complete_request_failure(e, _.ScriptLoad), this.fail_runtime(Error(t.message));
			}, n.onmessageerror = () => {
				if (!this.is_active_record(e)) {
					if (this.mark_inactive_requester_closing(e)) return;
					this.retire_record(e);
					return;
				}
				e.request_view !== void 0 && this.complete_request_failure(e, _.Protocol), this.fail_runtime(Error("worker message could not be decoded"));
			});
		}
		create_worker(e) {
			let t, r, i;
			try {
				t = this.read_command(e);
			} catch (e) {
				this.fail_runtime(e);
				return;
			}
			if (this.stopping_workers || c(new Int32Array(this.destroy_status)) !== n.Running) return void x(t.requestView, g.Cancelled, _.Destroyed, 0, new Int32Array(this.destroy_status));
			try {
				r = this.allocate_animal_id();
			} catch (e) {
				x(t.requestView, g.Failed, _.AnimalConstruction, 0, new Int32Array(this.destroy_status)), this.fail_runtime(e);
				return;
			}
			let a = this.assign_worker_id(), o = {
				animal_id: r,
				request_view: t.requestView,
				retired: !1,
				worker_id: a
			};
			this.workers[a] = o, this.pending_animal_workers.set(r, o), this.worker_animals.set(a, r);
			try {
				i = new Worker(t.url, { type: Atomics.load(e, 3) === 1 ? "module" : "classic" });
			} catch (e) {
				this.complete_request_failure(o, _.ScriptLoad), this.fail_runtime(e);
				return;
			}
			o.worker = i, this.register_handlers(o, !1);
			try {
				i.postMessage({
					...this.override_object,
					...t.obj,
					animal_id: r,
					worker_id: a,
					worker_background_ref: this.ref()
				});
			} catch (e) {
				this.complete_request_failure(o, _.AnimalConstruction), this.fail_runtime(e);
			}
		}
		create_start_worker(e) {
			let t, r, i;
			try {
				t = this.read_command(e);
			} catch (e) {
				this.fail_runtime(e);
				return;
			}
			if (this.stopping_workers || c(new Int32Array(this.destroy_status)) !== n.Running) return void x(t.requestView, g.Cancelled, _.Destroyed, 0, new Int32Array(this.destroy_status));
			if (this.start_worker_requested) return void x(t.requestView, g.Failed, _.Protocol, 0, new Int32Array(this.destroy_status));
			this.start_worker_requested = !0;
			try {
				r = this.allocate_animal_id();
			} catch (e) {
				x(t.requestView, g.Failed, _.AnimalConstruction, 0, new Int32Array(this.destroy_status)), this.fail_runtime(e);
				return;
			}
			let a = {
				animal_id: r,
				request_view: t.requestView,
				retired: !1,
				worker_id: 0
			};
			this.start_worker = a, this.pending_animal_workers.set(r, a), this.worker_animals.set(0, r);
			try {
				i = new Worker(t.url, { type: Atomics.load(e, 3) === 1 ? "module" : "classic" });
			} catch (e) {
				this.complete_request_failure(a, _.ScriptLoad), this.fail_runtime(e);
				return;
			}
			a.worker = i, this.register_handlers(a, !0);
			try {
				i.postMessage({
					...this.override_object,
					...t.obj,
					animal_id: r,
					worker_background_ref: this.ref()
				});
			} catch (e) {
				this.complete_request_failure(a, _.WasmInstantiation), this.fail_runtime(e);
				return;
			}
		}
		kill_animal(e) {
			if (c(new Int32Array(this.destroy_status)) !== n.Running) return;
			let t = this.animal_workers.get(e);
			t !== void 0 && (t === this.start_worker && this.cancel_runtime(), this.retire_record(t));
		}
		process_claimed_command(e) {
			switch (Atomics.load(e, 0)) {
				case 1:
					this.create_worker(e);
					break;
				case 2:
					this.create_start_worker(e);
					break;
				case 3:
					this.terminate_registered_workers();
					break;
				case 4: {
					let t = Atomics.load(e, 1);
					this.kill_animal(t);
					break;
				}
				default: this.fail_runtime(Error("unknown worker background command"), i.Protocol);
			}
		}
		async listen() {
			let e = new Int32Array(this.lock), t = new Int32Array(this.signature_input), r = new Int32Array(this.destroy_status);
			for (;;) {
				if (c(r) !== n.Running) return void await this.finish_listen_teardown(e, t);
				if (Atomics.load(e, 0) === C.Coordinator) {
					try {
						this.drain_retirements();
					} catch (e) {
						this.fail_runtime(e);
					} finally {
						ie(e);
					}
					continue;
				}
				let i = Atomics.load(e, 1), a = Atomics.load(e, 0);
				if (i === S.Idle && a === 0) {
					let t = Atomics.load(e, 6);
					if (Atomics.load(e, 1) !== i || Atomics.load(e, 0) !== a || c(r) !== n.Running || Atomics.load(e, 6) !== t) continue;
					let { value: o } = Atomics.waitAsync(e, 6, t);
					if ((o instanceof Promise ? await o : o) === "timed-out") throw Error("timed-out");
					continue;
				}
				if (await this.claim_command(e)) {
					if (c(r) !== n.Running) {
						try {
							this.cancel_claimed_command(t);
						} finally {
							this.acknowledge_command(e);
						}
						continue;
					}
					try {
						this.process_claimed_command(t);
					} catch (e) {
						this.fail_runtime(e);
					} finally {
						this.acknowledge_command(e);
					}
				}
			}
		}
	};
	globalThis.onmessage = (e) => {
		globalThis.onmessage = () => void 0;
		let { override_object: t, worker_background_ref_object: n } = e.data;
		oe.init_self(t, n), postMessage("ready");
	};
}
//#endregion
//#region src/polyfill.js
function Jt() {
	if (typeof Atomics.waitAsync == "function") return;
	let e = [];
	function t() {
		if (e.length > 0) {
			let t = e.pop();
			return t.terminationTimer &&= (clearTimeout(t.terminationTimer), null), t;
		}
		console.debug("Allocating new waitAsync helper worker");
		let t = new Blob(["\n    onmessage = function (ev) {\n      try {\n        switch (ev.data[0]) {\n          case 'wait': {\n            let [_, ia, index, value, timeout] = ev.data;\n            let result = Atomics.wait(ia, index, value, timeout);\n            postMessage(['ok', result]);\n            break;\n          }\n          default: {\n            throw new Error(\"Bogus message sent to wait helper: \" + ev.data.join(','));\n          }\n        }\n      } catch (e) {\n        // Notify the main thread of any errors\n        postMessage(['error', e.name + ': ' + e.message]);\n      }\n    }\n  "], { type: "application/javascript" }), n = URL.createObjectURL(t), r = new Worker(n);
		return URL.revokeObjectURL(n), r.onerror = (e) => {
			console.error("Error in waitAsync helper worker:", e.message, e.filename, e.lineno);
		}, r;
	}
	function n(t) {
		t.terminationTimer = setTimeout(() => {
			let n = e.indexOf(t);
			n !== -1 && (t.terminate(), e.splice(n, 1), console.debug("Terminated idle waitAsync helper worker"));
		}, 1e4), e.push(t);
	}
	function r(e, r, i, a) {
		if (typeof e != "object" || !(e instanceof Int32Array) || !(e.buffer instanceof SharedArrayBuffer)) throw TypeError("Atomics.waitAsync requires a shared Int32Array.");
		let o = r | 0, s = i | 0, c = a === void 0 ? Infinity : +a;
		if (o < 0 || o >= e.length) throw RangeError("Index out of bounds.");
		return Atomics.load(e, o) === s ? {
			async: !0,
			value: new Promise((r, i) => {
				let a = t();
				a.onmessage = (e) => {
					switch (n(a), a.onmessage = null, e.data[0]) {
						case "ok":
							r(e.data[1]);
							break;
						case "error":
							i(/* @__PURE__ */ Error(`Error in waitAsync helper: ${e.data[1]}`));
							break;
					}
				}, a.postMessage([
					"wait",
					e,
					o,
					s,
					c
				]);
			})
		} : {
			async: !1,
			value: "not-equal"
		};
	}
	Object.defineProperty(Atomics, "waitAsync", {
		value: r,
		configurable: !0,
		enumerable: !1,
		writable: !0
	});
}
//#endregion
//#region src/index.ts
var Yt = new URL("./worker_background_worker.min.js", "" + import.meta.url).href;
//#endregion
export { Tt as BaseCallCapacityError, Ce as DestroyerHandle, Kt as WASIFarm, Gt as WASIFarmAnimal, Rt as WASIFarmRef, _ as WorkerDestroyError, g as WorkerDestroyFailureCode, Ht as thread_spawn_on_worker, Jt as wait_async_polyfill, qt as worker_background_worker, Yt as worker_background_worker_url };

//# sourceMappingURL=browser-wasi-shim-threads.es.js.map