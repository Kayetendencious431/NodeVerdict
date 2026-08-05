// demo.js - reproduces the V8 JIT anti-patterns captured in v8-jit-trace.log
function makeUser(id, name) {
  // Same key set, different insertion order -> two hidden classes.
  const a = { id, name, age: 0 };
  const b = { name, age: 0, id };
  return a.id + b.name.length;
}

function buildUser(id, name, age) {
  const user = {};
  user.id = id;
  user.name = name;
  user.age = age;
  return user;
}

function aggregate(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    total += row.amount * (row.rate ?? 1);
  }
  return total;
}

function legacyWrap(fn) {
  return function dupe() {
    return fn.apply(this, arguments);
  };
}

module.exports = { makeUser, buildUser, aggregate, legacyWrap };
