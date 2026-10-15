// Reads every row of a query, a page at a time (the server answers at most
// 1000 rows a request). build() makes a fresh query each time.
export const PAGE = 1000;

export async function fetchAll(build, page = PAGE) {
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) return rows;
  }
}
