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
const repoRoot = resolve(__dirname, "..", "..", "..");
const webDir = resolve(__dirname, "..");

let composeFile: string;

const resolveComposeFile = async (): Promise<string> => {
	const lapseDevComposeFile = resolve(repoRoot, "lapse.dev.yaml");
	try {
		await fs.access(lapseDevComposeFile);
		return lapseDevComposeFile;
	}
	catch {
		return resolve(repoRoot, "docker-compose.dev.yaml");
	}
};

const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/lapse?schema=public";
let S3_ENDPOINT = "s3.localhost.localstack.cloud:4566";
let S3_PUBLIC_URL_PUBLIC = "http://lapse-public.s3.localhost.localstack.cloud:4566";
let S3_PUBLIC_URL_ENCRYPTED = "http://lapse-encrypted.s3.localhost.localstack.cloud:4566";
let S3_ACCESS_KEY_ID: string = "test";
let S3_SECRET_ACCESS_KEY: string = "test";

const banner = `
${chalk.cyan.bold("╔═══════════════════════════════════════════════════════════════╗")}
${chalk.cyan.bold("║")}                                                               ${chalk.cyan.bold("║")}
${chalk.cyan.bold("║")}   ${chalk.magenta.bold("⏱️  LAPSE")} ${chalk.gray("Development Environment Setup")}                      ${chalk.cyan.bold("║")}
${chalk.cyan.bold("║")}                                                               ${chalk.cyan.bold("║")}
${chalk.cyan.bold("╚═══════════════════════════════════════════════════════════════╝")}
`;


const logStep = (step: number, total: number, message: string) => {
	console.log(chalk.blue.bold(`\n[${step}/${total}]`) + chalk.white(` ${message}`));
};

const logError = (message: string) => {
	console.log(chalk.red.bold("  ✗ ") + chalk.red(message));
};

const logInfo = (message: string) => {
	console.log(chalk.cyan("  🛈 ") + chalk.gray(message));
};

const divider = () => {
	console.log(chalk.gray("\n" + "─".repeat(65)));
};

const askForInput = async (message: string): Promise<string> => {
	const answer = await input({
		message,
	});
	return answer;
};

const askLocalstackImage = async (): Promise<string> => {
	const answer = await select({
		message: "Select a LocalStack image: ",
		choices: [
			{ name: "localstack/localstack:latest", value: "localstack/localstack:latest" },
			{ name: "gresau/localstack-persist:latest (unofficial, but recommended)", value: "gresau/localstack-persist:latest" }
		],
	});
	return answer;
}

const askLocalstackOrR2 = async (): Promise<string> => {
	const answer = await select({
		message: "Select object storage solution: ",
		choices: [
			{ name: "LocalStack S3 (Easiest to set up)", value: "localstack" },
			{ name: "Cloudflare R2", value: "r2" }
		],
	});
	return answer;
}

const checkDockerRunning = async (): Promise<void> => {
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

const startDockerCompose = async (): Promise<void> => {
	const spinner = ora({
		text: chalk.gray("Starting Docker Compose services..."),
		color: "cyan",
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

const stopDockerCompose = async (): Promise<void> => {
	const spinner = ora({
		text: chalk.gray("Stopping Docker Compose services..."),
		color: "cyan",
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

const downDockerCompose = async (): Promise<void> => {
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


const waitForDatabase = async (): Promise<void> => {
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

const pushPrismaSchema = async (): Promise<void> => {
	const spinner = ora({
		text: chalk.gray("Pushing Prisma schema to database..."),
		color: "magenta",
	}).start();

	try {
		await execa("pnpm", ["db:push"], {
			cwd: webDir,
			env: { ...process.env, DATABASE_URL },
		});
		spinner.succeed(chalk.green("Prisma schema pushed successfully"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to push Prisma schema"));
		throw error;
	}
};

const guideR2Setup = async (): Promise<{ accessKeyId: string; secretAccessKey: string; s3_endpoint: string, public_url_public: string, public_url_encrypted: string }> => {
	// Guide user through R2 setup
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

const updateEnvFile = async (envVars: Record<string, string>): Promise<void> => {
	const spinner = ora({
		text: chalk.gray(`Updating .env file...`),
		color: "cyan",
	}).start();
	let env = "";
	try {
		env = await fs.readFile(resolve(webDir, ".env.example"), "utf-8");
		for (const [key, value] of Object.entries(envVars)) {
			env = env.replace(`${key}=`, `${key}=${value}`);
		}
		await fs.writeFile(resolve(webDir, ".env"), env);
		spinner.succeed(chalk.green("Environment variables updated successfully"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to update environment variables"));
		throw error;
	}
};

const buildLocalstackDockerComposeSection = (composeFileContent: string, localstackImage: string): string => {
	// Parse the existing docker-compose YAML file
	const composeObject = yaml.load(composeFileContent) as any;

	// Ensure services object exists
	if (!composeObject.services) {
		composeObject.services = {};
	}

	// Build the localstack service configuration
	const localstackService = {
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

	// Add the localstack service to the compose object
	composeObject.services.localstack = localstackService;

	// Convert the complete object back to a YAML string
	return yaml.dump(composeObject, {
		indent: 2,
		lineWidth: -1,
		noRefs: true,
	});
};


const updateDockerComposeFile = async (localstackImage: string | null): Promise<void> => {
	const spinner = ora({
		text: chalk.gray(`Updating docker-compose.dev.yaml...`),
		color: "cyan",
	}).start();
	let composeContent = await fs.readFile(composeFile, "utf-8");

	if (localstackImage) {
		// Build the complete updated compose file with localstack service added
		composeContent = buildLocalstackDockerComposeSection(composeContent, localstackImage);
	}
	// new name : lapse.dev.yaml
	composeFile = composeFile.replace("docker-compose.dev.yaml", "lapse.dev.yaml");
	await fs.writeFile(composeFile, composeContent);
	spinner.succeed(chalk.green("Docker Compose file updated successfully"));
};

const runSetup = async () => {
	console.clear();
	console.log(banner);

	const TOTAL_STEPS = 7;
	let currentStep = 0;

	try {
		await checkDockerRunning();
		let localstackORr2 = ""
		let localstackImage = "localstack/localstack:latest";

		// always use the original docker compose file for init
		composeFile = resolve(repoRoot, "docker-compose.dev.yaml");

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
		console.log(chalk.white.bold("Enter Slack bot token below (you can create a bot using the guide):"));
		console.log(chalk.cyan("https://scribehow.com/viewer/Create_a_Slack_App_and_Install_It__KF8a5b_5TeuzF_BWJJQg_g"));
		// wait for user input
		const SLACK_BOT_TOKEN = await askForInput("Enter Slack bot token: ");

		logStep(++currentStep, TOTAL_STEPS, "Updating environment variables...");
		await updateEnvFile({
			"SLACK_BOT_TOKEN": SLACK_BOT_TOKEN,
			"S3_ENDPOINT": S3_ENDPOINT,
			"S3_ACCESS_KEY_ID": S3_ACCESS_KEY_ID,
			"S3_SECRET_ACCESS_KEY": S3_SECRET_ACCESS_KEY,
			"S3_PUBLIC_URL_PUBLIC": S3_PUBLIC_URL_PUBLIC,
			"S3_PUBLIC_URL_ENCRYPTED": S3_PUBLIC_URL_ENCRYPTED,
		});


		// Success Message
		divider();
		console.log();
		console.log(chalk.bgGreen.black.bold(" SUCCESS ") + chalk.green.bold(" Development environment is ready! 🎉"));
		console.log();
		console.log(chalk.white("  Next steps:"));
		console.log(chalk.gray("  1. Run ") + chalk.cyan("pnpm turbo run dev") + chalk.gray(" to start the development server"));
		console.log(chalk.gray("  2. Open ") + chalk.cyan("http://localhost:3000") + chalk.gray(" in your browser"));
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

const main = async () => {
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
