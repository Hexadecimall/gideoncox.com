
export async function browserGitRequest(entries, operations) {
    if (!globalThis.zedBrowserGit) throw new Error('Browser Git is unavailable.');
    const { results, metadata } = await globalThis.zedBrowserGit.request(entries, operations);
    return [results, metadata];
}
