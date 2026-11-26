
export async function browserGitRequest(entries, operations, input, root, includeTree) {
    if (!globalThis.zedBrowserGit) throw new Error('Browser Git is unavailable.');
    const git = globalThis.zedBrowserGit;
    const { results, metadata, worktree } = root === undefined
        ? await git.request(entries, operations, input)
        : await git.requestSelectedFolder(root, includeTree, operations, input);
    return [results, metadata, worktree?.changed ?? null, worktree?.removed ?? null];
}
