import { Composition } from 'remotion';
import { Opening } from './Opening';

/* 影片目录：以后要加片只在这里登记一条 Composition（拿捏住「一处登记」）。 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 片头：8 秒 @30fps，1920×1080（16:9，与游戏战斗页同比例） */}
      <Composition
        id="Opening"
        component={Opening}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
