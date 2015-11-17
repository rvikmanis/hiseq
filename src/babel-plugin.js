export default function plugin({template, types: t}) {

  const FINALIZERS = [
    'array',
    'object',
    'reduce'
  ];

  const STEPS = [
    'map', 'filter', 'mapKeys',
    'filterKeys', 'flip'
  ];

  const buildMapStep = template(`
    $value = $mapper($value, $key);
    `);

  const buildFlipStep = template(`
    $tmp = $value;
    $value = $key;
    $key = $tmp;
    $tmp = null;
    `);

  const buildFilterStep = template(`
    if(!$predicate($value, $key)) {
      $skip = true;
    }
    `);

  const tpl_Arr2Arr = template(`
    (function(ARRAY) {
      var I = 0,
          R = 0,
          LEN = ARRAY.length,
          TMP, KEY, VALUE,
          RESULT = [],
          SKIP = false;
      for(;I<LEN;I++) {
        SKIP = false;
        VALUE = ARRAY[I];
        KEY = I;
        STEPS;
        if(!SKIP) RESULT[R++] = VALUE;
      }
      return RESULT;
    })(SOURCE);
    `);

  class Transformer {
    constructor(path, sequenceDescriptor) {
      this.path      = path;
      this.statement = path.getStatementParent();
      this.scope     = path.scope;

      this.source    = sequenceDescriptor.initial;
      this.steps     = sequenceDescriptor.sequenceCalls;
      this.finalizer = sequenceDescriptor.finalizingCall;

      this.loopIdentifiers = this.generateIdentifiers([
        'i', 'j', 'len',
        'source', 'sourceKeys',
        'target', 'targetKeys',
        'tmp', 'skip',
        'key', 'value'
      ]);
    }

    generateIdentifier(name = 'ref') {
      return this.scope.generateUidIdentifier(name);
    }

    generateDeclaredIdentifier(name = 'ref') {
      return this.scope.generateDeclaredUidIdentifier(name);
    }

    generateIdentifiers(names, fn = () => {}) {
      let identifiers = {};
      names.forEach(name => {
        identifiers[name] = this.generateIdentifier(fn(name));
      });
      return identifiers
    }

    run() {
      let {source, steps, finalizer, loopIdentifiers} = this;

      steps = steps.map(({name, args: [param]}) => {

        if (['map', 'mapKeys'].indexOf(name) !== -1) {
          let value = loopIdentifiers[name === 'map' ? "value" : "key"];
          let key = loopIdentifiers[name === 'map' ? "key" : "value"];
          let mapper = this.generateDeclaredIdentifier();

          this.insertPre(t.variableDeclaration('var', [
            t.variableDeclarator(mapper, param)
          ]));

          return buildMapStep({key, value, mapper});
        }

        else if (['filter', 'filterKeys'].indexOf(name) !== -1) {
          let value = loopIdentifiers[name === 'filter' ? "value" : "key"];
          let key = loopIdentifiers[name === 'filter' ? "key" : "value"];
          let predicate = this.generateDeclaredIdentifier();

          this.insertPre(t.variableDeclaration('var', [
            t.variableDeclarator(predicate, param)
          ]));

          return buildFilterStep({key, value, predicate});
        }

        else if (name === 'flip') {
          let {key, value, tmp} = loopIdentifiers;
          return buildFlipStep({key, value, tmp});
        }

        else { throw new Error(`Invalid step: ${name}`); }

      });

      this.path.replaceWith(tpl_Arr2Arr({
        // identifiers
        I: i,
        R: r,
        LEN: len,
        ARRAY: array,
        TMP: tmp,
        KEY: key,
        VALUE: value,
        RESULT: result,
        SKIP: skip,
        // actual values
        SOURCE: source,
        STEPS: steps
      }))
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
      //Program: visitProgram,
      //CallExpression: visitCallExpression,
      Program(a, b, c) {

        console.dir(b.file.ast, {depth: 5});

      }
    }
  }

}
