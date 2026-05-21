import Svg, { Path, Rect, Circle } from 'react-native-svg';

interface HouseWiseLogoProps {
  size?: number;
  color?: string;
}

export function HouseWiseLogo({ size = 60 }: HouseWiseLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60" fill="none">
      {/* House body */}
      <Path
        d="M10 26L30 10L50 26V52H36V38H24V52H10V26Z"
        fill="white"
      />
      {/* Door */}
      <Rect x="25" y="40" width="10" height="12" rx="2" fill="rgba(255,255,255,0.45)" />
      {/* Badge background (dark) */}
      <Circle cx="44" cy="19" r="9" fill="#0F6E56" />
      {/* Badge circle (light teal) */}
      <Circle cx="44" cy="19" r="7" fill="#5DCAA5" />
      {/* Checkmark */}
      <Path
        d="M40.5 19L43 21.5L47.5 16.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
