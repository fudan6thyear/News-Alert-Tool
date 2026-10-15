export function buildLegacyRows(startIso, endIso) {
  return [
    "publish_time,title,link,summary,source_key,source_name,source_list_url,source_page",
    `${startIso},Relative legacy article,https://example.com/relative-start,Relative start summary,relative_fixture,Relative Fixture,https://example.com/relative-feed,0`,
    `${endIso},Relative legacy end article,https://example.com/relative-end,Relative end summary,relative_fixture,Relative Fixture,https://example.com/relative-feed,1`,
  ];
}
