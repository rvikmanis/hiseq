export default function HiseqPlugin ({types: t}) {

  let macroIdentifier;

  const FINALIZING_CALLS = [
    'array',
    'object',
    'reduce'
  ];

  const SEQUENCE_CALLS = [
    'map', 'filter', 'mapKeys',
    'filterKeys', 'flip'
  ];

  function getMacroIdentifier(comment) {

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
    && FINALIZING_CALLS.indexOf(callee.property.name) !== -1
    && t.isMemberExpression(callee)) {
      return true;
    }
  }

  function getSequenceMacro(finalizingCall) {

    let currentCall;
    let sequenceCallsRev = [];
    let i = -1;

    if (!t.isCallExpression(finalizingCall.callee.object)) return;

    currentCall = finalizingCall.callee.object;

    while(++i >= 0) {
      // Iterate the method chain backwards
      // until reaching macroIdentifier call
      // or encountering an unsupported
      // sequence method

      let {callee, arguments: args} = currentCall;

      if (t.isMemberExpression(callee)) {
        let {object: obj, property: prop} = callee;

        if (!t.isIdentifier(prop)
        || SEQUENCE_CALLS.indexOf(prop.name) === -1
        || !t.isCallExpression(obj)) {
          return
        }

        sequenceCallsRev[i] = {name: prop.name, args};
        currentCall = obj;
        continue
      }

      else if (t.isIdentifier(callee) && callee.name === macroIdentifier) {
        sequenceCallsRev.reverse();

        return {
          initialArgs: args,
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
    if (macroIdentifier) return;
    body.container.comments.forEach(function(comment) {
      let mi = getMacroIdentifier(comment);
      if (mi) {
        macroIdentifier = mi;
        return false;
      }
    })
  }

  function visitCallExpression({node}) {
    if (isFinalizingCall(node)) {
      let macro = getSequenceMacro(node);
      console.dir(macro, {depth: 3});
    }
  }

  return {
    visitor: {
      Program: visitProgram,
      CallExpression: visitCallExpression
    }
  }

}
