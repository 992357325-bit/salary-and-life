// One fixed public homepage for every visitor. Never read location or form data.
export const SHARE_URL = 'https://992357325-bit.github.io/salary-and-life/';

export async function copyShareLink(clipboard) {
  try {
    await clipboard.writeText(SHARE_URL);
    return true;
  } catch {
    return false;
  }
}
