#!/usr/bin/env tsx
import { sleep } from "@/shared/common";
import chalk from "chalk";
import { Command } from "commander";
import { execa } from "execa";
import ora from "ora";
import { resolve } from "node:path";
import inquirer from "inquirer";
import fs from "node:fs/promises";


const DOCKER_STARTUP_DELAY = 1500;
const repoRoot = resolve(__dirname, "..", "..", "..");
const webDir = resolve(__dirname, "..");
const composeFile = resolve(repoRoot, "docker-compose.dev.yaml");

const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/lapse?schema=public";
const S3_ENDPOINT = "s3.localhost.localstack.cloud:4566";
const S3_PUBLIC_URL_PUBLIC = "http://lapse-public.s3.localhost.localstack.cloud:4566";
const S3_PUBLIC_URL_ENCRYPTED = "http://lapse-encrypted.s3.localhost.localstack.cloud:4566";

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
	console.log(chalk.cyan("  ℹ ") + chalk.gray(message));
};

const divider = () => {
	console.log(chalk.gray("\n" + "─".repeat(65)));
};

const askForInput = async (message: string): Promise<string> => {
	const answer = await inquirer.prompt([
		{
			type: "input",
			name: "answer",
			message,
		},
	]);
	return answer.answer;
};


const checkDockerRunning = async (): Promise<boolean> => {
	const spinner = ora({
		text: chalk.gray("Checking Docker daemon status..."),
		color: "cyan",
	}).start();

	try {
		await execa("docker", ["ps"], { cwd: repoRoot });
		spinner.succeed(chalk.green("Docker is running"));
		return true;
	}
	catch {
		spinner.fail(chalk.red("Docker is not running"));
		return false;
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

const updateEnvFile = async (SLACK_BOT_TOKEN: string): Promise<void> => {
	// read env.example and copy to .env
	const spinner = ora({
		text: chalk.gray(`Updating .env file...`),
		color: "cyan",
	}).start();
	let env = "";
	try {
		env = await fs.readFile(resolve(webDir, ".env.example"), "utf-8");
		env = env.replace("SLACK_BOT_TOKEN=", "SLACK_BOT_TOKEN=" + SLACK_BOT_TOKEN);
		env = env.replace("S3_ENDPOINT=", "S3_ENDPOINT=" + S3_ENDPOINT);
		env = env.replace("S3_ACCESS_KEY_ID=", "S3_ACCESS_KEY_ID=" + "test");
		env = env.replace("S3_SECRET_ACCESS_KEY=", "S3_SECRET_ACCESS_KEY=" + "test");
		env = env.replace("S3_PUBLIC_URL_PUBLIC=", "S3_PUBLIC_URL_PUBLIC=" + S3_PUBLIC_URL_PUBLIC);
		env = env.replace("S3_PUBLIC_URL_ENCRYPTED=", "S3_PUBLIC_URL_ENCRYPTED=" + S3_PUBLIC_URL_ENCRYPTED);

		await fs.writeFile(resolve(webDir, ".env"), env);

		spinner.succeed(chalk.green("Environment variables updated successfully"));
	}
	catch (error) {
		spinner.fail(chalk.red("Failed to update environment variables"));
		console.log("env:\n", env);
		throw error;
	}
};

const runSetup = async (options: { skipDocker?: boolean; skipDb?: boolean; onlyDocker?: boolean; init?: boolean }) => {
	console.clear();
	console.log(banner);

	const totalSteps = options.init ? 4 : (options.onlyDocker ? 1 : ([!options.skipDocker, !options.skipDb].filter(Boolean).length));
	let currentStep = 0;

	try {
		// Step 1: Check Docker
		if (!options.skipDocker || options.init) {
			logStep(++currentStep, totalSteps, "Checking Docker Environment");
			const isDockerRunning = await checkDockerRunning();

			if (!isDockerRunning) {
				console.log();
				console.log(chalk.bgRed.white.bold(" ERROR "));
				console.log(chalk.red("\nDocker is not running. Please start Docker Desktop and try again."));
				console.log(chalk.gray("\nTips:"));
				console.log(chalk.gray("  • On Windows/Mac: Start Docker Desktop application"));
				console.log(chalk.gray("  • On Linux: Run 'sudo systemctl start docker'"));
				divider();
				process.exit(1);
			}

			// Step 2: Start Docker Compose
			logStep(++currentStep, totalSteps, "Starting Docker Services");
			await startDockerCompose();
			await waitForDatabase();
		}

		// Step 3: Push Prisma Schema
		if ((!options.skipDb && !options.onlyDocker) || options.init) {
			logStep(++currentStep, totalSteps, "Setting Up Database");
			await pushPrismaSchema();
		}

		// Step 4: Setup Slack bot  
		if (options.init) {
			logStep(++currentStep, totalSteps, "Setting Up Slack Bot");
			console.log(chalk.white.bold("Open this Scribe and follow the instructions to set up the Slack bot, then paste the bot token below:"));
			console.log(chalk.cyan("https://scribehow.com/viewer/Create_a_Slack_App_and_Install_It__KF8a5b_5TeuzF_BWJJQg_g"));
			// wait for user input
			const SLACK_BOT_TOKEN = await askForInput("Enter Slack bot token: ");
			await updateEnvFile(SLACK_BOT_TOKEN);
		}


		// Success Message
		divider();
		console.log();
		console.log(chalk.bgGreen.black.bold(" SUCCESS ") + chalk.green.bold(" Development environment is ready! 🎉"));
		console.log();
		console.log(chalk.white("  Next steps:"));
		console.log(chalk.gray("  1. Run ") + chalk.cyan("pnpm turbo run dev") + chalk.gray(" to start the development server"));
		console.log(chalk.gray("  2. Open ") + chalk.cyan("http://localhost:3000") + chalk.gray(" in your browser"));
		divider();
		console.log();

	}
	catch (error) {
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


const program = new Command();

program
	.name("setup-dev-env")
	.description(chalk.gray("🛠️  Set up the Lapse development environment"))
	.version("1.0.0", "-v, --version", "Display version number")
	.option("--init", "Initialize the development environment", false)
	.option("--skip-docker", "Skip Docker checks and startup", false)
	.option("--skip-db", "Skip database setup (Prisma push)", false)
	.option("--only-docker", "Only start Docker services", true)
	.option("--stop-docker", "Stop Docker services", false)
	.action(async (options) => {
		if (options.stopDocker) {
			await stopDockerCompose();
			return;
		}
		await runSetup({
			skipDocker: options.skipDocker,
			skipDb: options.skipDb,
			onlyDocker: options.onlyDocker,
			init: options.init,
		});
	});

program.parse();
