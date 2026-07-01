/**
 * scheduler shim for React 19 (scheduler@0.26.0 compatibility)
 *
 * react-dom's CJS bundles emit `require("scheduler")` via CommonJS.
 * This file uses CommonJS `module.exports` so that Vite/Rollup/esbuild interop
 * always returns a plain object — no ESM default-export wrapping that breaks
 * the `var Scheduler = require("scheduler")` destructuring in react-dom.
 */

/* global performance, MessageChannel */

var ImmediatePriority    = 1;
var UserBlockingPriority = 2;
var NormalPriority       = 3;
var LowPriority          = 4;
var IdlePriority         = 5;

var maxSigned31BitInt = 1073741823;
var IMMEDIATE_PRIORITY_TIMEOUT      = -1;
var USER_BLOCKING_PRIORITY_TIMEOUT  = 250;
var NORMAL_PRIORITY_TIMEOUT         = 5000;
var LOW_PRIORITY_TIMEOUT            = 10000;
var IDLE_PRIORITY_TIMEOUT           = maxSigned31BitInt;

var taskQueue  = [];
var timerQueue = [];
var taskIdCounter       = 1;
var currentTask         = null;
var currentPriorityLevel = NormalPriority;
var isPerformingWork    = false;
var isHostCallbackScheduled = false;
var isHostTimeoutScheduled  = false;

var localSetTimeout   = typeof setTimeout   === "function" ? setTimeout   : null;
var localClearTimeout = typeof clearTimeout === "function" ? clearTimeout : null;

var getCurrentTime;
if (typeof performance === "object" && typeof performance.now === "function") {
  getCurrentTime = function () { return performance.now(); };
} else {
  var _startTime = Date.now();
  getCurrentTime = function () { return Date.now() - _startTime; };
}

var frameInterval = 5;
var startTime = -1;
var scheduledHostCallback = null;
var isMessageLoopRunning  = false;
var taskTimeoutID         = -1;

// Lazy-initialize MessageChannel so it doesn't run at module-eval time in SSR/node
var _channel = null;
function getChannel() {
  if (_channel) return _channel;
  if (typeof MessageChannel !== "undefined") {
    _channel = new MessageChannel();
    _channel.port1.onmessage = performWorkUntilDeadline;
  }
  return _channel;
}

function requestHostCallback(callback) {
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    var ch = getChannel();
    if (ch) {
      ch.port2.postMessage(null);
    } else if (localSetTimeout) {
      localSetTimeout(performWorkUntilDeadline, 0);
    }
  }
}

function requestHostTimeout(callback, ms) {
  if (localSetTimeout) {
    taskTimeoutID = localSetTimeout(function () { callback(getCurrentTime()); }, ms);
  }
}

function cancelHostTimeout() {
  if (localClearTimeout) localClearTimeout(taskTimeoutID);
  taskTimeoutID = -1;
}

function performWorkUntilDeadline() {
  if (scheduledHostCallback !== null) {
    var currentTime = getCurrentTime();
    startTime = currentTime;
    var hasMoreWork = true;
    try {
      hasMoreWork = scheduledHostCallback(true, currentTime);
    } finally {
      if (hasMoreWork) {
        var ch = getChannel();
        if (ch) { ch.port2.postMessage(null); }
        else if (localSetTimeout) { localSetTimeout(performWorkUntilDeadline, 0); }
      } else {
        isMessageLoopRunning  = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    isMessageLoopRunning = false;
  }
}

function shouldYieldToHost() {
  return getCurrentTime() - startTime >= frameInterval;
}

function advanceTimers(currentTime) {
  var timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
    } else {
      return;
    }
    timer = peek(timerQueue);
  }
}

function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);
  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      var firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

function flushWork(hasTimeRemaining, initialTime) {
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) { isHostTimeoutScheduled = false; cancelHostTimeout(); }
  isPerformingWork = true;
  var previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentTask            = null;
    currentPriorityLevel   = previousPriorityLevel;
    isPerformingWork       = false;
  }
}

function workLoop(hasTimeRemaining, initialTime) {
  var currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && (!hasTimeRemaining || shouldYieldToHost())) break;
    var callback = currentTask.callback;
    if (typeof callback === "function") {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      var didTimeout = currentTask.expirationTime <= currentTime;
      var cont = callback(didTimeout);
      currentTime = getCurrentTime();
      if (typeof cont === "function") {
        currentTask.callback = cont;
      } else {
        if (currentTask === peek(taskQueue)) pop(taskQueue);
      }
      advanceTimers(currentTime);
    } else {
      pop(taskQueue);
    }
    currentTask = peek(taskQueue);
  }
  if (currentTask !== null) {
    return true;
  } else {
    var ft = peek(timerQueue);
    if (ft !== null) requestHostTimeout(handleTimeout, ft.startTime - currentTime);
    return false;
  }
}

function unstable_scheduleCallback(priorityLevel, callback, options) {
  var currentTime = getCurrentTime();
  var startTime_;
  if (typeof options === "object" && options !== null && typeof options.delay === "number" && options.delay > 0) {
    startTime_ = currentTime + options.delay;
  } else {
    startTime_ = currentTime;
  }
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:    timeout = IMMEDIATE_PRIORITY_TIMEOUT;     break;
    case UserBlockingPriority: timeout = USER_BLOCKING_PRIORITY_TIMEOUT; break;
    case IdlePriority:         timeout = IDLE_PRIORITY_TIMEOUT;          break;
    case LowPriority:          timeout = LOW_PRIORITY_TIMEOUT;           break;
    default:                   timeout = NORMAL_PRIORITY_TIMEOUT;        break;
  }
  var expirationTime = startTime_ + timeout;
  var newTask = {
    id: taskIdCounter++, callback: callback, priorityLevel: priorityLevel,
    startTime: startTime_, expirationTime: expirationTime, sortIndex: -1,
  };
  if (startTime_ > currentTime) {
    newTask.sortIndex = startTime_;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      if (isHostTimeoutScheduled) { cancelHostTimeout(); } else { isHostTimeoutScheduled = true; }
      requestHostTimeout(handleTimeout, startTime_ - currentTime);
    }
  } else {
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }
  return newTask;
}

function unstable_cancelCallback(task) { task.callback = null; }
function unstable_getCurrentPriorityLevel() { return currentPriorityLevel; }
function unstable_shouldYield() { return shouldYieldToHost(); }
function unstable_requestPaint() {}
function unstable_now() { return getCurrentTime(); }
function unstable_pauseExecution() {}
function unstable_continueExecution() {
  if (!isHostCallbackScheduled && !isPerformingWork && peek(taskQueue) !== null) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}
function unstable_getFirstCallbackNode() { return peek(taskQueue); }
function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority: case UserBlockingPriority: case NormalPriority:
    case LowPriority: case IdlePriority: break;
    default: priorityLevel = NormalPriority;
  }
  var prev = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try { return eventHandler(); } finally { currentPriorityLevel = prev; }
}
function unstable_next(eventHandler) {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority: case UserBlockingPriority: case NormalPriority:
      priorityLevel = NormalPriority; break;
    default: priorityLevel = currentPriorityLevel;
  }
  var prev = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try { return eventHandler(); } finally { currentPriorityLevel = prev; }
}
function unstable_wrapCallback(callback) {
  var parentPriority = currentPriorityLevel;
  return function () {
    var prev = currentPriorityLevel;
    currentPriorityLevel = parentPriority;
    try { return callback.apply(this, arguments); } finally { currentPriorityLevel = prev; }
  };
}
function unstable_forceFrameRate(fps) {
  if (fps < 0 || fps > 125) return;
  frameInterval = fps > 0 ? Math.floor(1000 / fps) : 5;
}
function log() {}
function unstable_setDisableYieldValue() {}

// ── Min-heap ───────────────────────────────────────────────────────────────
function push(heap, node) {
  var i = heap.length; heap.push(node); siftUp(heap, node, i);
}
function peek(heap) { return heap.length === 0 ? null : heap[0]; }
function pop(heap) {
  if (heap.length === 0) return null;
  var first = heap[0]; var last = heap.pop();
  if (last !== first) { heap[0] = last; siftDown(heap, last, 0); }
  return first;
}
function siftUp(heap, node, i) {
  while (i > 0) {
    var pi = (i - 1) >>> 1; var parent = heap[pi];
    if (compare(parent, node) > 0) { heap[pi] = node; heap[i] = parent; i = pi; }
    else return;
  }
}
function siftDown(heap, node, i) {
  var len = heap.length; var half = len >>> 1;
  while (i < half) {
    var li = (i + 1) * 2 - 1; var left = heap[li];
    var ri = li + 1; var right = heap[ri];
    if (compare(left, node) < 0) {
      if (ri < len && compare(right, left) < 0) { heap[i] = right; heap[ri] = node; i = ri; }
      else { heap[i] = left; heap[li] = node; i = li; }
    } else if (ri < len && compare(right, node) < 0) {
      heap[i] = right; heap[ri] = node; i = ri;
    } else return;
  }
}
function compare(a, b) { var d = a.sortIndex - b.sortIndex; return d !== 0 ? d : a.id - b.id; }

// ── CommonJS export — MUST use module.exports (not ESM export) so that
//    esbuild/Rollup CJS interop gives react-dom a plain object directly
//    instead of an ESM wrapper with a .default property. ──────────────────
module.exports = {
  unstable_ImmediatePriority:    ImmediatePriority,
  unstable_UserBlockingPriority: UserBlockingPriority,
  unstable_NormalPriority:       NormalPriority,
  unstable_LowPriority:          LowPriority,
  unstable_IdlePriority:         IdlePriority,
  unstable_scheduleCallback:     unstable_scheduleCallback,
  unstable_cancelCallback:       unstable_cancelCallback,
  unstable_getCurrentPriorityLevel: unstable_getCurrentPriorityLevel,
  unstable_shouldYield:          unstable_shouldYield,
  unstable_requestPaint:         unstable_requestPaint,
  unstable_now:                  unstable_now,
  unstable_pauseExecution:       unstable_pauseExecution,
  unstable_continueExecution:    unstable_continueExecution,
  unstable_getFirstCallbackNode: unstable_getFirstCallbackNode,
  unstable_runWithPriority:      unstable_runWithPriority,
  unstable_next:                 unstable_next,
  unstable_wrapCallback:         unstable_wrapCallback,
  unstable_forceFrameRate:       unstable_forceFrameRate,
  unstable_setDisableYieldValue: unstable_setDisableYieldValue,
  log:                           log,
};
