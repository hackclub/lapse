#!/usr/bin/env tsx
import { sleep } from "@/shared/common";
import chalk from "chalk";
import { Command } from "commander";
import { execa } from "execa";
import ora from "ora";
import { resolve } from "node:path";
import { input, select } from "@inquirer/prompts";
import fs from "node:fs/promises";
import yaml from "js-yaml";

const DOCKER_STARTUP_DELAY = 1500;

const DEFAULT_DATABASE_PORT = 5432;
const DEFAULT_WEBSERVER_PORT = 3000;

let databasePort = DEFAULT_DATABASE_PORT;
let webserverPort = DEFAULT_WEBSERVER_PORT;

function getDatabaseUrl() {
    return `postgresql://postgres:postgres@localhost:${databasePort}/lapse?schema=public`;
}

let S3_ENDPOINT = "s3.localhost.localstack.cloud:4566";
let S3_PUBLIC_URL_PUBLIC = "http://lapse-public.s3.localhost.localstack.cloud:4566";
let S3_PUBLIC_URL_ENCRYPTED = "http://lapse-encrypted.s3.localhost.localstack.cloud:4566";
let S3_ACCESS_KEY_ID = "test";
let S3_SECRET_ACCESS_KEY = "test";

const repoRoot = resolve(__dirname, "..", "..", "..");
const webDir = resolve(__dirname, "..");

let composeFile: string;

async function resolveComposeFile() {
	const lapseDevComposeFile = resolve(repoRoot, "lapse.dev.yaml");

	try {
		await fs.access(lapseDevComposeFile);
		return lapseDevComposeFile;
	}
	catch {
		return resolve(repoRoot, "docker-compose.dev.yaml");
	}
}

function logStep(step: number, total: number, message: string) {
	console.log(chalk.blue.bold(`\n[${step}/${total}]`) + chalk.white(` ${message}`));
}

function logError(message: string) {
	console.log(chalk.red.bold("  ✗ ") + chalk.red(message));
}

function logInfo(message: string) {
	console.log(chalk.cyan("  🛈 ") + chalk.gray(message));
}

function divider() {
	console.log(chalk.gray("\n" + "─".repeat(65)));
}

async function askForInput(message: string) {
	return await input({ message });
}

async function askLocalstackImage() {
	return await select({
		message: "Select a LocalStack image: ",
		choices: [
			{ name: "localstack/localstack:latest", value: "localstack/localstack:latest" },
			{ name: "gresau/localstack-persist:latest (unofficial, but recommended)", value: "gresau/localstack-persist:latest" }
		]
	});
}

async function askLocalstackOrR2() {
	return await select({
		message: "Select object storage solution: ",
		choices: [
			{ name: "LocalStack S3 (easy setup)", value: "localstack" },
			{ name: "Cloudflare R2 (used in production)", value: "r2" }
		],
	});
}

async function askForPort(name: string, defaultPort: number): Promise<number> {
	const portStr = await input({
		message: `Enter ${name} port (default: ${defaultPort}): `,
		default: String(defaultPort),
	});

	const port = parseInt(portStr);
	if (isNaN(port) || port < 1 || port > 65535)
		throw new Error(`Invalid port number: ${portStr}`);

	return port;
}

async function checkDockerRunning() {
	const spinner = ora({
		text: chalk.gray("Checking Docker daemon status..."),
		color: "cyan",
	}).start();

	try {
		await execa("docker", ["ps"], { cwd: repoRoot });
		spinner.succeed(chalk.green("Docker is running"));
	}
	catch {
		spinner.fail(chalk.red("Docker is not running"));
		console.log();
		console.log(chalk.bgRed.white.bold(" ERROR "));
		console.log(chalk.red("\nDocker is not running. Please start Docker Desktop and try again."));
		console.log(chalk.gray("\nTips:"));
		console.log(chalk.gray("  • On Windows/Mac: Start Docker Desktop application"));
		console.log(chalk.gray("  • On Linux: Run 'sudo systemctl start docker'"));
		divider();
		process.exit(1);
	}
};

async function startDockerCompose() {
	const spinner = ora({
		text: chalk.gray("Starting Docker Compose services..."),
		color: "cyan"
	}).start();

	try {
		await execa("docker", ["compose", "-f", composeFile, "up", "-d"], {
			cwd: repoRoot,
		});

		spinner.succeed(chalk.green("Docker Compose services started"));
		logInfo(`Using compose file: ${chalk.italic(composeFile)}`);
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to start Docker Compose"));
		throw error;
	}
};

async function stopDockerCompose() {
	const spinner = ora({
		text: chalk.gray("Stopping Docker Compose services..."),
		color: "cyan"
	}).start();

	try {
		await execa("docker", ["compose", "-f", composeFile, "stop"], {
			cwd: repoRoot,
		});

		spinner.succeed(chalk.green("Docker Compose services stopped"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to stop Docker Compose"));
		throw error;
	}
};

async function downDockerCompose() {
	const spinner = ora({
		text: chalk.gray("Stopping Docker Compose services..."),
		color: "cyan",
	}).start();

	try {
		await execa("docker", ["compose", "-f", composeFile, "down"], {
			cwd: repoRoot,
		});
		spinner.succeed(chalk.green("Docker Compose services stopped"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to stop Docker Compose"));
		throw error;
	}
};

async function waitForDatabase() {
	const spinner = ora({
		text: chalk.gray(`Waiting for database to be ready (${DOCKER_STARTUP_DELAY / 1000}s)...`),
		color: "yellow",
	}).start();

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frameIndex = 0;
	const interval = setInterval(() => {
		spinner.text = chalk.gray(`Waiting for database ${frames[frameIndex]} `);
		frameIndex = (frameIndex + 1) % frames.length;
	}, 100);

	await sleep(DOCKER_STARTUP_DELAY);

	clearInterval(interval);
	spinner.succeed(chalk.green("Database should be ready"));
};

async function pushPrismaSchema() {
	const spinner = ora({
		text: chalk.gray("Pushing Prisma schema to database..."),
		color: "magenta",
	}).start();

	try {
		await execa("pnpm", ["db:push"], {
			cwd: webDir,
			env: { ...process.env, DATABASE_URL: getDatabaseUrl() },
		});

		spinner.succeed(chalk.green("Prisma schema pushed successfully"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to push Prisma schema"));
		throw error;
	}
};

async function guideR2Setup() {
	console.log(chalk.white.bold("\nTo use Cloudflare R2 for object storage, you'll need to create two R2 buckets and obtain access credentials."));
	console.log(chalk.white("Follow these steps:"));
	console.log(chalk.gray("\n  1. Log in to your Cloudflare dashboard at ") + chalk.cyan("https://dash.cloudflare.com/"));
	console.log(chalk.gray("  2. Press CTRL+K to search, and look up \"R2 object storage\"."));
	console.log(chalk.gray("  3. Create two buckets: ") + chalk.cyan("lapse-encrypted") + chalk.gray(" and ") + chalk.cyan("lapse-public") + chalk.gray("."));
	console.log(chalk.gray("  4. Set the CORS policy of both buckets to the following:"));
	console.log(chalk.cyan('     [{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "PUT", "HEAD", "POST", "DELETE"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]'));
	console.log(chalk.gray("  5. Navigate to the \"API Tokens\" section in your Cloudflare dashboard."));
	console.log(chalk.gray("  6. Create a new API token with the following permissions:"));
	console.log(chalk.gray('     • Account - R2 Storage: Read, Write, List'));
	console.log(chalk.gray("  7. Once created, note down the Access Key ID and Secret Access Key."));
	console.log(chalk.gray("  8. Obtain your R2 S3 Endpoint URL, which typically looks like: ") + chalk.cyan("https://<account_id>.r2.cloudflarestorage.com"));
	console.log(chalk.gray("  9. Obtain public URLs, from the Settings of each bucket, which typically looks like: ") + chalk.cyan("(e.g. https://pub-<random-string>.r2.dev)") + chalk.gray("."));
	console.log(chalk.gray("\nAfter completing these steps, please provide the following information:\n"));

	const s3_endpoint = await askForInput("Enter Cloudflare R2 S3 Endpoint (e.g., <account_id>.r2.cloudflarestorage.com, DO NOT include the 'https://' prefix): ");
	const accessKeyId = await askForInput("Enter Cloudflare R2 Access Key ID: ");
	const secretAccessKey = await askForInput("Enter Cloudflare R2 Secret Access Key: ");
	const public_url_public = await askForInput("Enter Cloudflare R2 Public URL for Public Bucket: ");
	const public_url_encrypted = await askForInput("Enter Cloudflare R2 Public URL for Encrypted Bucket: ");

	return { accessKeyId, secretAccessKey, s3_endpoint, public_url_public, public_url_encrypted };
}

async function updateEnvFile(envVars: Record<string, string>) {
	const spinner = ora({
		text: chalk.gray(`Updating .env file...`),
		color: "cyan",
	}).start();

	let env = "";
	try {
		env = await fs.readFile(resolve(webDir, ".env.example"), "utf-8");
		for (const [key, value] of Object.entries(envVars)) {
			env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
		}

		await fs.writeFile(resolve(webDir, ".env"), env);
		spinner.succeed(chalk.green("Environment variables updated successfully"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to update environment variables"));
		throw error;
	}
};

/**
 * Adds a Localstack service to an existing Docker Compose file.
 */
function buildLocalstackDockerComposeSection(composeFileContent: string, localstackImage: string) {
	const composeObject = yaml.load(composeFileContent) as any;

	if (!composeObject.services) {
		composeObject.services = {};
	}

	composeObject.services.localstack = {
		image: localstackImage,
		container_name: "localstack-container",
		ports: ["4566:4566"],
		environment: [
			"SERVICES=s3",
			"DEBUG=1",
			"PERSISTENCE=1",
			"S3_VIRTUAL_HOSTNAME=localhost",
			"DATA_DIR=/var/lib/localstack",
		],
		volumes: [
			"/var/run/docker.sock:/var/run/docker.sock",
			"./init-s3.sh:/etc/localstack/init/ready.d/init-s3.sh",
			...(localstackImage.includes("persist") ? ["./localstack-data:/persisted-data"] : []),
		],
	};

	return yaml.dump(composeObject, {
		indent: 2,
		lineWidth: -1,
		noRefs: true,
	});
};


async function updateDockerComposeFile(localstackImage: string | null) {
	const spinner = ora({
		text: chalk.gray(`Updating docker-compose.dev.yaml...`),
		color: "cyan",
	}).start();

	let composeContent = await fs.readFile(composeFile, "utf-8");
	const composeObject = yaml.load(composeContent) as Record<string, unknown>;

	// Update database port if non-default
	if (databasePort !== DEFAULT_DATABASE_PORT && composeObject.services) {
		const services = composeObject.services as Record<string, { ports?: string[] }>;
		if (services["lapse-db"]?.ports) {
			services["lapse-db"].ports = [`${databasePort}:5432`];
		}
	}

	composeContent = yaml.dump(composeObject, {
		indent: 2,
		lineWidth: -1,
		noRefs: true,
	});

	if (localstackImage) {
		composeContent = buildLocalstackDockerComposeSection(composeContent, localstackImage);

		// Ensure the init-s3.sh script is executable (required for LocalStack init hooks)
		const initS3Path = resolve(repoRoot, "init-s3.sh");
		await fs.chmod(initS3Path, 0o755);
	}

	// new name: lapse.dev.yaml
	composeFile = composeFile.replace("docker-compose.dev.yaml", "lapse.dev.yaml");
	await fs.writeFile(composeFile, composeContent);
	spinner.succeed(chalk.green("Docker Compose file updated successfully"));
};

async function runSetup() {
	console.clear();

	const TOTAL_STEPS = 8;
	let currentStep = 0;

	try {
		await checkDockerRunning();
		let localstackORr2 = ""
		let localstackImage = "localstack/localstack:latest";

		// always use the original docker compose file for init
		composeFile = resolve(repoRoot, "docker-compose.dev.yaml");

		logStep(++currentStep, TOTAL_STEPS, "Configuring ports...");
		databasePort = await askForPort("database", DEFAULT_DATABASE_PORT);
		webserverPort = await askForPort("web server", DEFAULT_WEBSERVER_PORT);

		logStep(++currentStep, TOTAL_STEPS, "Configuring storage backend...");
		localstackORr2 = await askLocalstackOrR2();

		if (localstackORr2 == "r2") {
			const r2Credentials = await guideR2Setup();
			S3_ENDPOINT = r2Credentials.s3_endpoint;
			S3_ACCESS_KEY_ID = r2Credentials.accessKeyId;
			S3_SECRET_ACCESS_KEY = r2Credentials.secretAccessKey;
			S3_PUBLIC_URL_PUBLIC = r2Credentials.public_url_public;
			S3_PUBLIC_URL_ENCRYPTED = r2Credentials.public_url_encrypted;
		}
		else if (localstackORr2 == "localstack") {
			localstackImage = await askLocalstackImage();
			logInfo(`Using LocalStack image: ${chalk.italic(localstackImage)}`);
		}

		logStep(++currentStep, TOTAL_STEPS, "Updating Docker Compose configuration...");
		await updateDockerComposeFile(localstackORr2 == "localstack" ? localstackImage : null);

		logStep(++currentStep, TOTAL_STEPS, "Starting Docker containers...");
		await startDockerCompose();

		logStep(++currentStep, TOTAL_STEPS, "Waiting for database to be ready...");
		await waitForDatabase();

		logStep(++currentStep, TOTAL_STEPS, "Pushing Prisma schema to database...");
		await pushPrismaSchema();

		logStep(++currentStep, TOTAL_STEPS, "Configuring Slack integration...");
		console.log("You will need a Slack bot configured to access data like profile pictures.");
		console.log("The token to this bot should have a 'xoxb-' prefix. Check the guide below for help!");
		console.log(chalk.cyan("https://url.ascpixi.dev/lapse-slack-setup"));
		console.log("");

		const SLACK_BOT_TOKEN = await askForInput("Enter Slack bot token (xoxb-...): ");

		logStep(++currentStep, TOTAL_STEPS, "Updating environment variables...");
		await updateEnvFile({
			"DATABASE_URL": getDatabaseUrl(),
			"PORT": webserverPort.toString(),
			"HACKATIME_REDIRECT_URI": `http://localhost:${webserverPort}/api/auth-hackatime`,
			"SLACK_BOT_TOKEN": SLACK_BOT_TOKEN,
			"S3_ENDPOINT": S3_ENDPOINT,
			"S3_ACCESS_KEY_ID": S3_ACCESS_KEY_ID,
			"S3_SECRET_ACCESS_KEY": S3_SECRET_ACCESS_KEY,
			"S3_PUBLIC_URL_PUBLIC": S3_PUBLIC_URL_PUBLIC,
			"S3_PUBLIC_URL_ENCRYPTED": S3_PUBLIC_URL_ENCRYPTED,
		});

		divider();
		console.log();
		console.log(chalk.bgGreen.black.bold(" SUCCESS ") + chalk.green.bold(" Development environment is ready! 🎉"));
		console.log();
		console.log(chalk.white("  Next steps:"));
		console.log(chalk.gray("  1. Run ") + chalk.cyan("pnpm turbo run dev") + chalk.gray(" to start the development server"));
		console.log(chalk.gray("  2. Open ") + chalk.cyan(`http://localhost:${webserverPort}`) + chalk.gray(" in your browser"));
		divider();

	}
	catch (error) {
		// Clean-up
		await stopDockerCompose();

		console.log("error:", error);
		divider();
		console.log();
		console.log(chalk.bgRed.white.bold(" SETUP FAILED "));
		console.log();

		if (error instanceof Error) {
			logError(error.message);
		}

		console.log(chalk.gray("\nPlease check the error above and try again."));
		divider();
		process.exit(1);
	}
};

async function main() {
	composeFile = await resolveComposeFile();

	const program = new Command();

	program
		.name("setup-dev-env")
		.description(chalk.gray("🛠️  Set up the Lapse development environment"))
		.version("1.0.0", "-v, --version", "Display version number")
		.option("--init", "Initialize the development environment", false)
		.option("--only-docker", "Only start Docker services", false)
		.option("--stop-docker", "Stop Docker services", false)
		.option("--down-docker", "Stop and remove Docker services", false)
		.action(async (options) => {
			if (options.downDocker) {
				await checkDockerRunning();
				await downDockerCompose();
				return;
			}

			if (options.stopDocker) {
				await stopDockerCompose();
				return;
			}

			if (options.onlyDocker) {
				await checkDockerRunning();
				await startDockerCompose();
				return;
			}
			
			await runSetup();
		});

	await program.parseAsync();
};

void main();
