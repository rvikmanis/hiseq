export default function plugin({template, types: t}) {

  const FINALIZERS = [
    'array',
    'object',
    'reduce',
    'groupBy'
  ];

  const STEPS = [
    'map', 'filter', 'mapKeys',
    'filterKeys', 'flip'
  ];

  const mapTpl = template(`
    value = mapper(value, key);
    `);

  const flipTpl = template(`
    tmp = (tmp = value,
    value = key,
    key = tmp,
    null);
    `);

  const filterTpl = template(`
    if(!predicate(value, key)) {
      skip = true;
    }
    `);

  const loopInvocationTpl = template(`
    loop(source)
    `);

  const commonLoopTpl = template(`
    function loop(source) {
      var i, j,
          len, tmp,
          key, value,
          sourceKeys,
          target,
          skip;

      i = 0;
      if (source.constructor === Object) {
        sourceKeys = Object.keys(source);
        len = sourceKeys.length;
      }
      else if (source.constructor === Array) {
        len = source.length;
      }
      else throw new Error("Unsupported type of: " + source);

      INIT_TARGET;

      for(;i<len;i++) {
        skip = false;
        key = sourceKeys == null ? i : sourceKeys[i];
        value = source[key];

        EACH_RUN_STEPS;

        if(!skip) {
          EACH_UPDATE_TARGET;
        }
      }

      RETURN_TARGET;
    }
    `);

  const initArrayTargetTpl = template(`
    j = 0;
    target = [];
    `);

  const initObjectTargetTpl = template(`
    target = {};
    `);

  const initReduceWithInitialAccumulatorTargetTpl = template(`
    target = initialAccumulator;
    `);

  const initReduceTargetTpl = template(`
    target = void 0;
    `);

  const eachUpdateArrayTargetTpl = template(`
    target[j++] = value;
    `);

  const eachUpdateObjectTargetTpl = template(`
    target[key] = value;
    `);

  const eachUpdateReduceTargetTpl = template(`
    target = (target === (void 0) && i === 0) ?
      value : reducer(target, value, key);
    `)

  const returnTargetTpl = template(`
    return target;
    `);

  const groupByReducerTpl = template(`
    (function(a, x, k) {
      var group = findKey(x, k);
      a[group] = a[group] === (void 0) ?
        [x] : a[group].concat([x]);
      return a;
    })
    `)

  class Transformer {
    constructor(path, sequenceDescriptor) {
      this.path      = path;
      this.statement = path.getStatementParent();
      this.scope     = this.statement.scope;

      this.source    = sequenceDescriptor.initial;
      this.steps     = sequenceDescriptor.sequenceCalls;
      this.finalizer = sequenceDescriptor.finalizingCall;

      this.loopRefs = this.refs([
        'i', 'j', 'len',
        'source', 'sourceKeys',
        'target',
        'tmp', 'skip',
        'key', 'value'
      ], name => name);
    }

    ref(name = 'hs_ref') {
      return this.scope.generateUidIdentifier(name);
    }

    refs(names, fn = () => {}) {
      let identifiers = {};
      names.forEach(name => {
        identifiers[name] = this.ref(fn(name));
      });
      return identifiers
    }

    insert(nodes) {
      return this.statement.insertBefore(nodes)
    }

    declare(...pairs) {
      if (pairs.length === 2 && t.isIdentifier(pairs[0])) {
        pairs = [pairs];
      }
      let declarators = pairs
        .filter(([_, v]) => v != null)
        .map(([k, v]) => t.variableDeclarator(k, v));
      let declaration = t.variableDeclaration('var', declarators);
      this.insert(declaration);
      return declaration;
    }

    buildMapStep(mapper, flip=false) {
      let value = this.loopRefs[!flip ? "value" : "key"];
      let key = this.loopRefs[!flip ? "key" : "value"];
      return mapTpl({key, value, mapper});
    }

    buildFilterStep(predicate, flip=false) {
      let value = this.loopRefs[!flip ? "value" : "key"];
      let key = this.loopRefs[!flip ? "key" : "value"];
      return filterTpl({key, value, predicate});
    }

    buildFlipStep() {
      let {key, value, tmp} = this.loopRefs;
      return flipTpl({key, value, tmp});
    }

    buildLoop(loop, steps) {
      let {target, i, source, sourceKeys, j, key, value} = this.loopRefs;
      let init, eachUpdate;
      let loopReturn = returnTargetTpl({target});

      if (this.finalizer.name === "array") {
        init = initArrayTargetTpl({target, j});
        eachUpdate = eachUpdateArrayTargetTpl({target, j, value});
      }

      else if (this.finalizer.name === "object") {
        init = initObjectTargetTpl({target});
        eachUpdate = eachUpdateObjectTargetTpl({target, key, value});
      }

      else if (this.finalizer.name === "reduce") {
        let [fn, initialAccumulatorValue] = this.finalizer.args;

        let reducer = this.ref();
        let initialAccumulator = this.ref();

        this.declare(
          [reducer, fn],
          [initialAccumulator, initialAccumulatorValue]
        );

        eachUpdate = eachUpdateReduceTargetTpl({
          target, reducer, value, key, i
        });

        if (initialAccumulatorValue === void 0) {
          init = initReduceTargetTpl({
            target
          })
        }

        else {
          init = initReduceWithInitialAccumulatorTargetTpl({
            target, initialAccumulator
          });
        }
      }

      return commonLoopTpl({
        RETURN_TARGET: loopReturn,
        INIT_TARGET: init,
        EACH_UPDATE_TARGET: eachUpdate,
        EACH_RUN_STEPS: steps,
        loop,
        ...this.loopRefs
      })

    }

    buildLoopInvocation(loop) {
      return loopInvocationTpl({loop, source: this.source});
    }

    setFinalizer(name, ...args) {
      this.finalizer.name = name;
      this.finalizer.args = args;
    }

    pre() {
      if (this.finalizer.name === "groupBy") {
        let [param] = this.finalizer.args;
        let findKey = this.ref();
        this.declare(findKey, param);
        this.setFinalizer(
          'reduce',
          groupByReducerTpl({findKey}).expression,
          t.objectExpression([])
        )
        return this.pre();
      }
    }

    run() {

      this.pre();

      let steps = this.steps.map(({name, args: [param]}) => {

        if (['map', 'mapKeys'].indexOf(name) !== -1) {
          let mapper = this.ref();
          this.declare(mapper, param);
          return this.buildMapStep(mapper, name === "mapKeys");
        }

        else if (['filter', 'filterKeys'].indexOf(name) !== -1) {
          let predicate = this.ref();
          this.declare(predicate, param);
          return this.buildFilterStep(predicate, name === "filterKeys");
        }

        else if (name === 'flip') {
          return this.buildFlipStep();
        }

        else { throw new Error(`Invalid step: ${name}`); }

      });

      let loop = this.ref();
      this.insert(this.buildLoop(loop, steps));
      this.path.replaceWith(this.buildLoopInvocation(loop))
    }
  }

  let sourceCallableName;

  function getSourceCallableName(comment) {

    if (comment.type !== 'CommentBlock') return;
    let value = comment.value.trim();

    if (value.startsWith("hiseq:")) {
      let identifier = value.split(": on=")[1];

      return identifier != null ? identifier : void 0
    }
  }

  function isFinalizingCall(node) {

    let callee = node.callee;
    let isMemberExp = t.isMemberExpression(callee);

    if (t.isIdentifier(callee.property)
    && FINALIZERS.indexOf(callee.property.name) !== -1
    && t.isMemberExpression(callee)) {
      return true;
    }
  }

  function getSequenceDescriptor(finalizingCall) {

    let currentCall;
    let sequenceCallsRev = [];
    let i = -1;

    if (!t.isCallExpression(finalizingCall.callee.object)) return;

    currentCall = finalizingCall.callee.object;

    while(++i >= 0) {
      // Iterate the method chain backwards
      // until reaching sourceCallableName call
      // or encountering an unsupported
      // sequence method

      let {callee, arguments: args} = currentCall;

      if (t.isMemberExpression(callee)) {
        let {object: obj, property: prop} = callee;

        if (!t.isIdentifier(prop)
        || STEPS.indexOf(prop.name) === -1
        || !t.isCallExpression(obj)) {
          return
        }

        sequenceCallsRev[i] = {name: prop.name, args};
        currentCall = obj;
        continue
      }

      else if (t.isIdentifier(callee) && callee.name === sourceCallableName) {
        sequenceCallsRev.reverse();

        return {
          initial: args,
          sequenceCalls: sequenceCallsRev,
          finalizingCall: {
            name: finalizingCall.callee.property.name,
            args: finalizingCall.arguments
          }
        }
      }

      // Stop iteration
      return
    }

  }

  function visitProgram(body) {
    if (sourceCallableName) return;
    body.container.comments.forEach(function(comment) {
      let name = getSourceCallableName(comment);
      if (name) {
        sourceCallableName = name;
        return false;
      }
    })
  }

  function visitCallExpression(path) {
    if (isFinalizingCall(path.node)) {
      let desc = getSequenceDescriptor(path.node);
      if (desc) {
        let tf = new Transformer(path, desc);
        tf.run();
      }
    }
  }

  return {
    visitor: {
      Program: visitProgram,
      CallExpression: visitCallExpression
    }
  }

}
