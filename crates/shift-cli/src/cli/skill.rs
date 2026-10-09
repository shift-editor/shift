use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Subcommand)]
pub enum SkillCommand {
    /// Print the skill, or one of its reference topics.
    Show(ShowSkillArgs),

    /// Install the skill for Claude Code and for agents that read .agents/skills.
    Install(InstallSkillArgs),

    /// Report whether installed copies match this command's skill.
    Status(SkillStatusArgs),
}

#[derive(Debug, Args)]
pub struct SkillIdentityArgs {
    /// The command the skill names, such as shift-cli-nightly. Defaults to the
    /// name this program was run as, so each Shift build installs its own skill.
    #[arg(long, value_name = "NAME")]
    pub command: Option<String>,
}

#[derive(Debug, Args)]
pub struct ShowSkillArgs {
    /// Section to print; the overview lists the others.
    #[arg(value_enum, default_value_t = SkillTopic::Overview)]
    pub topic: SkillTopic,

    #[command(flatten)]
    pub identity: SkillIdentityArgs,
}

#[derive(Debug, Args)]
pub struct InstallSkillArgs {
    /// Install into your home directory for every project, instead of the current directory.
    #[arg(short, long)]
    pub global: bool,

    /// Which agents' skill directories to write.
    #[arg(long, value_enum, default_value_t = SkillAgent::All)]
    pub agent: SkillAgent,

    /// Only update copies this command installed earlier; never create new ones.
    #[arg(long)]
    pub refresh_only: bool,

    /// Replace a skill directory of the same name that shift-cli did not install.
    #[arg(long)]
    pub force: bool,

    /// Emit a structured result for scripts and agents.
    #[arg(long)]
    pub json: bool,

    #[command(flatten)]
    pub identity: SkillIdentityArgs,
}

#[derive(Debug, Args)]
pub struct SkillStatusArgs {
    /// Check your home directory instead of the current directory.
    #[arg(short, long)]
    pub global: bool,

    /// Which agents' skill directories to check.
    #[arg(long, value_enum, default_value_t = SkillAgent::All)]
    pub agent: SkillAgent,

    /// Emit a structured result for scripts and agents.
    #[arg(long)]
    pub json: bool,

    #[command(flatten)]
    pub identity: SkillIdentityArgs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum SkillTopic {
    Overview,
    Mcp,
    Cli,
    Fonts,
    VariableFonts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum SkillAgent {
    /// `.agents/skills` (Codex, OpenCode, VS Code, Cursor) and `.claude/skills` (Claude Code).
    All,
    /// `.agents/skills`, read by Codex, OpenCode, VS Code, and Cursor.
    Agents,
    /// `.claude/skills`, read by Claude Code.
    Claude,
}
