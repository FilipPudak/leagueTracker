export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}
