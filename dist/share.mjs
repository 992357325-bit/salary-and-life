// One fixed public homepage for every visitor. Never read location or form data.
export const SHARE_URL = 'https://salary-and-life.witty-moss-2962.chatgpt.site';

export async function copyShareLink(clipboard) {
  try {
    await clipboard.writeText(SHARE_URL);
    return true;
  } catch {
    return false;
  }
}
