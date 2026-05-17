import pandas as pd

df = pd.read_csv("hf://datasets/tucnguyen/ShareChat/chatgpt_results_final_language_filtered.csv")

# Define target topics
target_topics = [
    "creative_ideation",
    "edit_or_critique_provided_text",
    "argument_or_summary_generation",
    "personal_writing_or_communication",
    "write_fiction"
]

# Filter by topics and English language
filtered_df = df[
    (df["topic"].isin(target_topics)) &
    (df["detected_language_final"] == "English")
]

# Each conversation is identified by its URL; turns_count holds the round count per message row.
# Drop duplicates so we get one turns_count value per conversation.
conv_turns = filtered_df.drop_duplicates(subset=["url"])[["url", "topic", "turns_count"]]

# Average rounds and sample count per topic
avg_by_topic = (
    conv_turns
    .groupby("topic")["turns_count"]
    .agg(avg_rounds="mean", n_samples="count")
    .round({"avg_rounds": 2})
    .reset_index()
    .sort_values("avg_rounds", ascending=False)
)

# Overall average and total sample count across all selected topics
overall_avg = conv_turns["turns_count"].mean()
total_samples = len(conv_turns)

print("Average rounds of conversation by topic (English only):")
print(avg_by_topic.to_string(index=False))
print(f"\nOverall average across all 5 topics: {overall_avg:.2f}")
print(f"Total samples: {total_samples}")