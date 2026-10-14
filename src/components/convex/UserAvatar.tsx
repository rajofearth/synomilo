import React, { useMemo, useState } from 'react';
import {
  ColorValue,
  Image,
  ImageStyle,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Avatar } from 'react-native-paper';
import {
  type AvatarEntity,
  initialsFor,
  resolveAvatar,
} from '../../utils/avatar';

/**
 * The one place an avatar photo is drawn.
 *
 * Every avatar render site in the app routes through here so that:
 *   - the URL comes from `resolveAvatar` (the Convex `avatarUrl` wins, a bare
 *     `avatar` field second, initials last), and
 *   - a URL that fails to load degrades to the same initials instead of
 *     rendering an empty transparent box. Before this existed, none of the
 *     avatar `<Image>`s in the app had an `onError` at all.
 *
 * `variant="paper"` renders react-native-paper's `Avatar.Text` for the
 * fallback so screens that already used it keep their exact look; the photo
 * branch is a bare `<Image>` sized by `imageStyle` (defaults to `size`).
 *
 * `variant="text"` renders a plain `View` + `Text`, for screens that built
 * their avatar out of raw `View`/`Image`/`Text` primitives.
 */
type UserAvatarProps = {
  /** The user projection (or any object carrying an avatar field). */
  entity?: AvatarEntity;
  /** Fallback label for initials. */
  name?: string | null;
  /** A URL the caller already resolved; wins over `entity`. */
  override?: string | null;
  size: number;
  variant?: 'paper' | 'text';
  shape?: 'circle' | 'rounded';
  /** Overrides the corner radius derived from `size` + `shape`. */
  radius?: number;
  /** Photo branch only. */
  imageStyle?: StyleProp<ImageStyle>;
  /** Wrapper for `variant="text"` (both branches). Unused by `variant="paper"`. */
  containerStyle?: StyleProp<ViewStyle>;
  /** `Avatar.Text` `style` prop: background + border radius. */
  initialsStyle?: StyleProp<ViewStyle>;
  labelColor?: ColorValue;
  labelStyle?: StyleProp<TextStyle>;
};

const UserAvatar: React.FC<UserAvatarProps> = ({
  entity,
  name,
  override,
  size,
  variant = 'paper',
  shape = 'circle',
  radius,
  imageStyle,
  containerStyle,
  initialsStyle,
  labelColor,
  labelStyle,
}) => {
  // A URL that 404'd is remembered per-instance so the initials branch sticks
  // for the rest of this screen's life instead of re-requesting every render.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  const resolved = useMemo(
    () => resolveAvatar(entity, name, override),
    [entity, name, override],
  );

  const uri =
    resolved.kind === 'url' && resolved.uri !== brokenUrl ? resolved.uri : null;
  const initials =
    resolved.kind === 'initials' ? resolved.initials : initialsFor(name);
  const corner = radius ?? (shape === 'circle' ? size / 2 : Math.round(size * 0.3));

  const photo = uri ? (
    <Image
      source={{ uri }}
      onError={() => setBrokenUrl(uri)}
      // `variant="text"` renders this inside a wrapper of exactly `size`, so
      // `size` is correct for both branches.
      style={[{ width: size, height: size, borderRadius: corner }, imageStyle]}
    />
  ) : null;

  if (variant === 'text') {
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: corner,
            alignItems: 'center',
            justifyContent: 'center',
          },
          containerStyle,
        ]}
      >
        {photo ?? (
          <Text
            numberOfLines={1}
            style={[labelStyle, labelColor ? { color: labelColor } : null]}
          >
            {initials}
          </Text>
        )}
      </View>
    );
  }

  return (
    photo ?? (
      <Avatar.Text
        size={size}
        label={initials}
        color={labelColor as string | undefined}
        style={initialsStyle}
        labelStyle={labelStyle}
      />
    )
  );
};

export default UserAvatar;