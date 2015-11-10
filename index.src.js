const T_MAP = "map";
const T_FILTER = "filter";
const T_FLIP = "flip";
const T_PACK = "pack";
const T_UNPACK = "unpack";

function isArray(v) {
  return v != null && v.constructor === Array;
}

function isPlainObject(v) {
  return v != null && v.constructor === Object;
}

function isFunction(v) {
  return v != null && v.constructor === Function;
}

function isString(v) {
  return v != null && v.constructor === String;
}

function isNumber(v) {
  return v != null && v.constructor === Number;
}

function identity(x) {
  return x;
}

function arrayReduce(array, fn, a, keys) {
  var index = -1,
      length = array.length;

  if ((a === void 0) && length) {
    a = array[++index];
  }
  while (++index < length) {
    a = fn(a, array[index], keys ? keys[index] : index);
  }
  return a;
}

function arrayEach(array, fn, keys, checkReturnValue) {
  var index = -1,
      length = array.length,
      sc;

  if (checkReturnValue) {
    while (++index < length) {
      sc = fn(array[index], keys ? keys[index] : index);
      if (sc === false) break;
    }
    return;
  }

  while (++index < length) {
    fn(array[index], keys ? keys[index] : index);
  }
}

function buildObject(keys, values) {
  if (keys.length !== values.length) {
    throw new Error("buildObject(keys, values): " +
      "args `keys` and `values` must be arrays of equal size");
  }

  let out = {};
  let k;
  for (let i = 0; i < keys.length; i++) {
    k = keys[i];
    out[k] = values[i];
  }
  return out;
}

function transform(keys, values, transformations) {
  if (keys.length !== values.length) {
    throw new Error("transform(keys, values, ...): " +
      "args `keys` and `values` must be arrays of equal size");
  }

  let len = keys.length;

  let result = Array(len);
  let resultKeys = Array(len);

  if (!transformations || !transformations.length) {
    return [keys, values];
  }

  let len_t = transformations.length;
  let i_t;
  let t;
  let t_arg;

  let i = -1;
  let r_i = i;
  let v, k;
  let skip = false;
  let skipped = 0;

  while (++i < len) {
    k = keys[i];
    v = values[i];
    r_i++;

    i_t = -1;
    while (++i_t < len_t) {
      t = transformations[i_t];
      t_arg = t[1];
      t = t[0];

      if (T_MAP === t) {
        v = t_arg(v, k);
      }

      else if (T_FILTER === t) {
        if (!t_arg(v, k)) {
          skip = true;
          break
        }
      }

      else if (T_FLIP === t) {
        [v, k] = [k, v];
      }

      else if (T_PACK === t) {
        v = [k, v];
      }

      else if (T_UNPACK === t) {
        k = v[0];
        v = v[1];
      }
    }

    if (skip) {
      r_i--;
      skipped++;
      skip = false;
      continue
    }

    result[r_i] = v;
    resultKeys[r_i] = k;
  }

  if (skipped) {
    result.splice(len - skipped, skipped);
    resultKeys.splice(len - skipped, skipped);
  }

  return [resultKeys, result];

}

const Aggregators = {
  min: {
    accumulator: Infinity,
    step(a, x) { return Math.min(a, x) }
  },

  max: {
    accumulator: -Infinity,
    step(a, x) { return Math.max(a, x) }
  },

  avg: {
    accumulator: [0, 0],
    step(a, x) {
      return [a[0] + x, a[1] + 1]
    },
    finalize(a) {
      return a[0] / a[1]
    }
  },

  sum: {
    accumulator: 0,
    step(a, x) { return a + x }
  },

  product: {
    accumulator: 1,
    step(a, x) { return a * x }
  }
}

class Sequence {

  // values;
  // keys;
  // transformations;

  constructor(iter, keys, transformations) {
    if (iter && iter.constructor === Sequence) return iter;

    let len, i;

    if (isArray(iter)) {
      len = iter.length;

      if (!isArray(keys)) {
        keys = Array(len);
        for (i=0; i<len; i++) {
          keys[i] = i;
        }
      } else {
        if (keys.length !== len) {
          throw new Error("Sequence.prototype.constructor(iter, keys, ...): " +
            "args `iter` and `keys` must be of equal size");
        }
      }

      this.values = iter;
      this.keys = keys;
    }

    else if (isPlainObject(iter)) {
      // overwrite keys and transformations
      keys = Object.keys(iter);
      transformations = [];
      len = keys.length;
      let values = Array(len);
      for (i=0; i<len; i++) {
        values[i] = iter[keys[i]];
      }

      this.values = values;
      this.keys = keys;
    }

    else {
      throw new Error("Cannot create sequence from: `" + iter + "`");
    }

    this.transformations = isArray(transformations) ? transformations : [];
  }

  clone() {
    let res = this.transform(true);
    return new this.constructor(res[1], res[0]);
  }

  addTransformation(t, arg) {
    return new this.constructor(
      this.values,
      this.keys,
      this.transformations.concat([[t, arg]])
    )
  }

  transform(commit) {
    if (this.transformations.length)
    {
      let r = transform(this.keys, this.values, this.transformations);
      if (commit) {
        this.keys = r[0];
        this.values = r[1];
        this.transformations = [];
      }
      return r;
    }
    return [this.keys, this.values];
  }

  each(fn, checkReturnValue = false) {
    let res = this.transform(true);
    arrayEach(res[1], fn, res[0], checkReturnValue);
  }

  array() {
    let res = this.transform(true);
    return res[1];
  }

  object() {
    let res = this.transform(true);
    return buildObject(res[0], res[1]);
  }

  reduce(fn, a) {
    let res = this.transform(true);
    return arrayReduce(res[1], fn, a, res[0]);
  }

  join(withStr='') {
    return this.reduce((a, x) => (a === '' ? a : a + withStr) + String(x), '');
  }

  string() {
    return this.join();
  }

  flatten() {
    return new Sequence(this.reduce(
      (a, v) => a.concat(isArray(v) ? v : [v]),
      []
    ))
  }

  any(fn = (x) => x) {
    let s = false;
    this.each((v, k) => {
      if (fn(v, k)) {
        s = true;
        return EOF;
      }
    }, true);
    return s;
  }

  all(fn = (x) => x) {
    return !this.any((v, k) => !fn(v, k));
  }

  contains(q) {
    let res = this.transform(true);
    return res[1].indexOf(q) !== -1;
  }

  merge(...iterables) {
    let res;
    let next = this.clone();
    let ks = next.keys;
    let vs = next.values;
    let i, ii, len = iterables.length;
    let kslen;

    for(i=0; i<len; i++) {
      ii = iterables[i];
      kslen = ks.length;
      if (isArray(ii)) {
        res = new Sequence(ii).mapKeys(k => k + kslen).transform(true);
      }
      else {
        res = new Sequence(ii).transform(true);
      }
      ks = ks.concat(res[0]);
      vs = vs.concat(res[1]);
    }

    return new Sequence(vs, ks);
  }

  map(field=identity, fn=identity) {
    let f;

    if (isFunction(field)) {
      f = field
    }
    else if (isString(field)||isNumber(field)) {
      f = (v, k) => fn(v[field], k)
    }
    else if (isArray(field)) {
      f = (v, k) => {
        if (fn === identity) {
          fn = (...v) => v
        }
        return fn(
          ...(new Sequence(field).map(field => v[field]).array()));
      }
    }
    else throw new Error("map: invalid argument");

    return this.addTransformation(T_MAP, f);
  }

  flip() {
    return this.addTransformation(T_FLIP);
  }

  mapKeys(...a) {
    return this.flip().map(...a).flip();
  }

  pack() {
    return this.addTransformation(T_PACK);
  }

  unpack() {
    return this.addTransformation(T_UNPACK);
  }

  filter(field=identity, fn=identity) {
    let f;

    if (isFunction(field)) {
      f = field
    }
    else if (isString(field)||isNumber(field)) {
      f = (v, k) => fn(v[field], k)
    }
    else if (isArray(field)) {
      f = (v, k) => {
        if (fn === identity) {
          fn = (...v) => new Sequence(v).all()
        }
        return fn(
          ...(new Sequence(field).map(field => v[field]).array()));
      }
    }
    else throw new Error("filter: invalid argument");

    return this.addTransformation(T_FILTER, f)
  }
}

let sequence = module.exports = function sequence(source) {
  return new Sequence(source);
}

sequence.isArray = isArray;
sequence.isPlainObject = isPlainObject;
sequence.merge = function merge(...iterables) {
  return sequence([], []).merge(...iterables);
}
