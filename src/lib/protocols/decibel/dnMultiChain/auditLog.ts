export function logDnExecutor(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      tag: "[DN-Executor]",
      event,
      at: new Date().toISOString(),
      ...data,
    })
  );
}
