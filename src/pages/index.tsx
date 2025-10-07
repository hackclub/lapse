import Link from "next/link";
import { useAuth } from "../client/hooks/useAuth";
import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { LoadingModal } from "@/client/components/ui/LoadingModal";
import Icon from "@hackclub/icons";

export default function Home() {
  const { currentUser, isLoading, signOut } = useAuth(false);
  const isLoggedIn = currentUser != null;

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full py-8 items-center justify-center">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center">
            {
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-4">
                  <h1 className="text-6xl font-bold text-smoke leading-tight">
                    Lapse <sup>α</sup>
                  </h1>
                  
                  <p className="text-smoke text-xl leading-relaxed">
                    {
                      currentUser
                        ? <>Thank you for participating in the alpha, <span className="text-cyan">{currentUser.displayName}</span>!</>
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
                            <Icon glyph="view-close" size={24} />
                            Sign Out
                          </Button>
                        </>
                      )
                      : (
                        <Link href="/auth">
                          <Button className="gap-2" kind="primary" onClick={() => {}}>
                            <Icon glyph="welcome" size={24} />
                            Log In
                          </Button>
                        </Link>
                      )

                  }


                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
