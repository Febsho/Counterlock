export type LabeledRequest<Label extends string = string> = { label: Label; promise: Promise<unknown> };

export async function settleLabeledRequests<Label extends string>(requests: readonly LabeledRequest<Label>[]) {
  const results = await Promise.allSettled(requests.map(({ promise }) => promise));
  const values = new Map<Label, unknown>();
  const errors: Label[] = [];
  results.forEach((result, index) => result.status === "fulfilled"
    ? values.set(requests[index].label, result.value)
    : errors.push(requests[index].label));
  return { values, errors };
}
