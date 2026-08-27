// Generate a consistent, vibrant color based on a string (e.g. user's name)
export const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Use HSL for vibrant, distinct colors
  const h = Math.abs(hash) % 360;
  const s = 70 + (Math.abs(hash) % 20); // 70-90%
  const l = 45 + (Math.abs(hash) % 15); // 45-60%
  
  return `hsl(${h}, ${s}%, ${l}%)`;
};
