module.exports = {
  $randomEmail,
  $randomString,
};

function $randomEmail(context, events, done) {
  const randomString = Math.random().toString(36).substring(7);
  context.vars.email = `test-${randomString}@example.com`;
  return done();
}

function $randomString(context, events, done) {
  context.vars.randomString = Math.random().toString(36).substring(7);
  return done();
}
