import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";
import Icon from "@hackclub/icons";

import { useAuth } from "@/client/hooks/useAuth";
import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";

import LapseIcon from "@/client/assets/icon.svg";
import { frng, pickRandom } from "@/shared/common";

export default function Home() {
  const router = useRouter();
  const { currentUser, signOut } = useAuth(false);

  useEffect(() => {
    const { error } = router.query;
    
    if (error) {
      router.push(`/auth?error=${error}`);
    }
  }, [router.query, router]);

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full py-8 items-center justify-center">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center">
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center justify-center gap-8">
                  <LapseIcon
                    className="w-32 select-none hover:scale-105 transition-transform active:scale-95"
                    onClick={(ev: MouseEvent) => {
                      // this plays a silly sound every time the user clicks on the logo! :D
                      let sound = pickRandom([
                        "eep.wav",
                        "quack.wav"
                      ]);

                      if (Math.random() < 0.1) {
                        sound = "chrismeow.wav"; // mr. chris walker meowing.
                      }

                      const audio = new Audio(`/audio/${sound}`);
                      
                      audio.preservesPitch = false;
                      audio.playbackRate = frng(0.8, 1.2);
                      audio.onended = () => audio.remove();
                      audio.play();

                      if (ev.target instanceof SVGElement) {
                        ev.target.style.cursor = "pointer";
                      }
                    }}
                  />

                  <h1 className="text-6xl font-bold text-smoke leading-tight">
                    Lapse <sup>α</sup>
                  </h1>
                </div>
                
                <p className="text-smoke text-xl leading-relaxed">
                  {
                    currentUser
                      ? <>Thank you for participating in the alpha, <span className="text-cyan font-bold">{currentUser.displayName}</span>!</>
                      : <>Lapse is a timelapse recording tool, currently in alpha.</>
                  }
                </p>
              </div>
              
              <div className="flex gap-4 justify-center">
                {
                  currentUser
                    ? (
                      <>
                        <Link href="/timelapse/create">
                          <Button className="gap-2" kind="primary" onClick={() => {}}>
                            <Icon glyph="plus-fill" size={24} />
                            Create Timelapse
                          </Button>
                        </Link>
                        
                        <Button className="gap-2" onClick={signOut} kind="secondary">
                          <Icon glyph="door-leave" size={24} />
                          Sign Out
                        </Button>
                      </>
                    )
                    : (
                      <Link href="/auth">
                        <Button className="gap-2 px-16" kind="primary" onClick={() => {}}>
                          <Icon glyph="welcome" size={24} />
                          Sign in
                        </Button>
                      </Link>
                    )
                  }
              </div>
            </div>
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
