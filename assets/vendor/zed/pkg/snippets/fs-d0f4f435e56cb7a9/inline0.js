
export async function browserGitRequest(entries, operations, input) {
    if (!globalThis.zedBrowserGit) throw new Error('Browser Git is unavailable.');
    const { results, metadata, worktree } = await globalThis.zedBrowserGit.request(entries, operations, input);
    return [results, metadata, worktree?.changed ?? null, worktree?.removed ?? null];
}
