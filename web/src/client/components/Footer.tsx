import { TimeAgo } from "./TimeAgo";
import { Link } from "./ui/Link";
import buildInfoJson from "@/generated/build-info.json";

interface BuildInfo {
  commitId: string;
  commitShort: string;
  buildDate: number;
  contributors: Array<{ name: string; github?: string }>;
}

const buildInfo = buildInfoJson as BuildInfo;

function ContributorLink({ name, github }: { name: string; github?: string }) {
  if (github) {
    return (
      <a
        href={`https://github.com/${github}`}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="underline"
      >
        {name}
      </a>
    );
  }
  
  return <>{name}</>;
}

export function Footer() {
  const { commitShort, buildDate, contributors } = buildInfo;

  const hasValidBuild = commitShort && commitShort !== "dev" && buildDate > 0;

  return (
    <footer className="py-16 text-placeholder text-center space-y-2">
      <p>
        A Hack Club production.
        {hasValidBuild ? (
          <>
            {" "}Build{" "}
            <Link 
              href={`https://github.com/hackclub/lapse/commit/${buildInfo.commitId}`}
              content={commitShort}
              newTab
            />
            {" "}from <TimeAgo date={buildDate} />.
          </>
        ) : null}
        {" "}Report issues at <Link newTab href="https://github.com/hackclub/lapse" />.
      </p>
      {contributors.length > 0 ? (
        <p>
          Built with <span className="text-red px-1">❤︎</span> by{" "}
          {contributors.map((c, i) => (
            <span key={c.name}>
              {i > 0 && (i === contributors.length - 1 ? ", and " : ", ")}
              <ContributorLink name={c.name} github={c.github} />
            </span>
          ))}
          .
        </p>
      ) : null}
    </footer>
  );
}
